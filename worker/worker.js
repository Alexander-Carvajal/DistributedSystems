import amqp from "amqplib";
import mysql from "mysql2/promise";
import { MongoClient } from "mongodb";
import Redis from "ioredis";

const required = (name) => {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
};

const database = process.env.MONGO_DB || "store";
const hosts = required("MONGO_HOSTS");
const authDatabase = encodeURIComponent(process.env.MONGO_AUTH_DB || database);
const mongoUri = `mongodb://${encodeURIComponent(required("MONGO_USER"))}:${encodeURIComponent(required("MONGO_PASSWORD"))}@${hosts}/${encodeURIComponent(database)}?replicaSet=${encodeURIComponent(required("MONGO_REPLICA_SET"))}&authSource=${authDatabase}&retryWrites=true&w=majority`;
const mongo = new MongoClient(mongoUri, { maxPoolSize: 5, serverSelectionTimeoutMS: 10000 });
const reviews = mongo.db(database).collection("product_reviews");
const pool = mysql.createPool({
  host: required("DB_HOST"),
  port: Number(process.env.DB_PORT || 3306),
  database: required("DB_NAME"),
  user: required("DB_USER"),
  password: required("DB_PASSWORD"),
  connectionLimit: 3,
  connectTimeout: 5000,
});
const redis = new Redis({
  sentinels: required("REDIS_SENTINELS").split(",").map((endpoint) => {
    const [host, port] = endpoint.trim().split(":");
    return { host, port: Number(port) };
  }),
  name: required("REDIS_MASTER_NAME"),
  password: required("REDIS_PASSWORD"),
  sentinelPassword: required("REDIS_PASSWORD"),
  connectTimeout: 2000,
  maxRetriesPerRequest: 2,
});
const amqpHost = process.env.AMQP_HOST || "store-queue.store-queue.svc.cluster.local";
const amqpUser = encodeURIComponent(required("AMQP_USER"));
const amqpPassword = encodeURIComponent(required("AMQP_PASSWORD"));
const amqpUrl = `amqp://${amqpUser}:${amqpPassword}@${amqpHost}:${process.env.AMQP_PORT || 5672}`;
const cacheKey = "catalog:cheapest:v1";
const eventsExchange = "store.events";
const deadExchange = "store.dead";
let brokerConnection;
let workerChannel;
let shuttingDown = false;

const declareTopology = async (channel) => {
  await channel.assertExchange(eventsExchange, "direct", { durable: true });
  await channel.assertExchange(deadExchange, "direct", { durable: true });
  await channel.assertQueue("reviews.created", {
    durable: true,
    arguments: {
      "x-queue-type": "quorum",
      "x-dead-letter-exchange": deadExchange,
      "x-dead-letter-routing-key": "reviews.dlq",
    },
  });
  await channel.assertQueue("reviews.retry", {
    durable: true,
    arguments: {
      "x-queue-type": "quorum",
      "x-message-ttl": 5000,
      "x-dead-letter-exchange": eventsExchange,
      "x-dead-letter-routing-key": "reviews.created",
    },
  });
  await channel.assertQueue("reviews.dlq", { durable: true, arguments: { "x-queue-type": "quorum" } });
  await channel.assertQueue("catalog.dlq", { durable: true, arguments: { "x-queue-type": "quorum" } });
  await channel.assertQueue("catalog.refresh", { durable: true, arguments: { "x-queue-type": "quorum" } });
  await channel.assertQueue("catalog.changed", { durable: true, arguments: { "x-queue-type": "quorum" } });
  for (const routingKey of ["catalog.refresh", "catalog.changed"]) {
    await channel.assertQueue(`${routingKey}.retry`, {
      durable: true,
      arguments: {
        "x-queue-type": "quorum",
        "x-message-ttl": 5000,
        "x-dead-letter-exchange": eventsExchange,
        "x-dead-letter-routing-key": routingKey,
      },
    });
    await channel.bindQueue(`${routingKey}.retry`, eventsExchange, `${routingKey}.retry`);
  }
  await channel.bindQueue("reviews.created", eventsExchange, "reviews.created");
  await channel.bindQueue("reviews.retry", eventsExchange, "reviews.retry");
  await channel.bindQueue("reviews.dlq", deadExchange, "reviews.dlq");
  await channel.bindQueue("catalog.dlq", deadExchange, "catalog.dlq");
  await channel.bindQueue("catalog.refresh", eventsExchange, "catalog.refresh");
  await channel.bindQueue("catalog.changed", eventsExchange, "catalog.changed");
};

const handleEvent = async (routingKey, event) => {
  if (event?.schemaVersion !== 1 || typeof event.eventId !== "string") {
    throw new Error("Unsupported or invalid event envelope");
  }
  if (routingKey === "reviews.created") {
    const { idempotencyKey, review } = event;
    if (typeof idempotencyKey !== "string" || !review?.sku || !review?.reviewer) {
      throw new Error("Invalid reviews.created payload");
    }
    await reviews.updateOne(
      { idempotencyKey },
      { $setOnInsert: { ...review, idempotencyKey, createdAt: new Date(review.createdAt) } },
      { upsert: true },
    );
    return;
  }
  if (routingKey === "catalog.refresh") {
    const [products] = await pool.execute(
      "SELECT id, sku, name, description, price FROM products ORDER BY price ASC, id ASC LIMIT 10",
    );
    await redis.set(cacheKey, JSON.stringify(products), "EX", 60);
    await redis.del(`${cacheKey}:refresh-lock`);
    return;
  }
  if (routingKey === "catalog.changed") {
    await redis.del(cacheKey, `${cacheKey}:refresh-lock`);
    return;
  }
  throw new Error(`Unsupported event routing key: ${routingKey}`);
};

const start = async () => {
  await mongo.connect();
  brokerConnection = await amqp.connect(amqpUrl);
  brokerConnection.on("close", () => {
    if (shuttingDown) return;
    console.error("RabbitMQ connection closed; restarting worker for a clean reconnect");
    process.exit(1);
  });
  workerChannel = await brokerConnection.createConfirmChannel();
  await declareTopology(workerChannel);
  await workerChannel.prefetch(10);
  console.log("Store queue worker connected; consuming reviews and catalog events");

  for (const queue of ["reviews.created", "catalog.refresh", "catalog.changed"]) {
    await workerChannel.consume(queue, async (message) => {
      if (!message) return;
      const routingKey = message.fields.routingKey;
      const attempt = Number(message.properties.headers?.["x-attempt"] || 0);
      try {
        const event = JSON.parse(message.content.toString("utf8"));
        await handleEvent(routingKey, event);
        workerChannel.ack(message);
      } catch (error) {
        console.error(`Event ${routingKey} failed (attempt ${attempt + 1}):`, error.message);
        const retryable = ["reviews.created", "catalog.refresh", "catalog.changed"].includes(routingKey);
        const retryRoutingKey = routingKey === "reviews.created" ? "reviews.retry" : `${routingKey}.retry`;
        const deadRoutingKey = routingKey === "reviews.created" ? "reviews.dlq" : "catalog.dlq";
        const nextRoutingKey = attempt < 4 ? retryRoutingKey : deadRoutingKey;
        const exchange = attempt < 4 && retryable ? eventsExchange : deadExchange;
        workerChannel.publish(exchange, nextRoutingKey, message.content, {
          contentType: message.properties.contentType || "application/json",
          deliveryMode: 2,
          headers: { ...message.properties.headers, "x-attempt": attempt + 1, "x-last-error": error.message.slice(0, 250) },
        });
        try {
          await workerChannel.waitForConfirms();
          workerChannel.ack(message);
        } catch {
          workerChannel.nack(message, false, true);
        }
      }
    }, { noAck: false });
  }
};

const shutdown = async () => {
  shuttingDown = true;
  await Promise.allSettled([
    workerChannel?.close(),
    brokerConnection?.close(),
    pool.end(),
    mongo.close(),
    redis.quit(),
  ]);
  process.exit(0);
};
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);

start().catch((error) => {
  console.error("Worker startup failed:", error);
  process.exitCode = 1;
});
