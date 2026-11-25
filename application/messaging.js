import amqp from "amqplib";

const eventsExchange = "store.events";
const deadExchange = "store.dead";

let connection;
let channel;
let setupPromise;

const amqpUrl = () => {
  const user = encodeURIComponent(process.env.AMQP_USER || "");
  const password = encodeURIComponent(process.env.AMQP_PASSWORD || "");
  const host = process.env.AMQP_HOST || "store-queue.store-queue.svc.cluster.local";
  const port = process.env.AMQP_PORT || "5672";
  return `amqp://${user}:${password}@${host}:${port}`;
};

const connect = () => {
  if (channel) return channel;
  if (setupPromise) return setupPromise;
  setupPromise = (async () => {
    if (!connection) {
      connection = amqp.connect(amqpUrl()).catch((error) => {
        connection = undefined;
        throw error;
      });
    }
    const connected = await connection;
    connected.on("close", () => {
      connection = undefined;
      channel = undefined;
      setupPromise = undefined;
    });
    const confirmed = await connected.createConfirmChannel();
    await confirmed.assertExchange(eventsExchange, "direct", { durable: true });
    await confirmed.assertExchange(deadExchange, "direct", { durable: true });
    await confirmed.assertQueue("reviews.created", {
      durable: true,
      arguments: {
        "x-queue-type": "quorum",
        "x-dead-letter-exchange": deadExchange,
        "x-dead-letter-routing-key": "reviews.dlq",
      },
    });
    await confirmed.assertQueue("reviews.retry", {
      durable: true,
      arguments: {
        "x-queue-type": "quorum",
        "x-message-ttl": 5000,
        "x-dead-letter-exchange": eventsExchange,
        "x-dead-letter-routing-key": "reviews.created",
      },
    });
    await confirmed.assertQueue("reviews.dlq", { durable: true, arguments: { "x-queue-type": "quorum" } });
    await confirmed.assertQueue("catalog.dlq", { durable: true, arguments: { "x-queue-type": "quorum" } });
    await confirmed.assertQueue("catalog.refresh", { durable: true, arguments: { "x-queue-type": "quorum" } });
    await confirmed.assertQueue("catalog.changed", { durable: true, arguments: { "x-queue-type": "quorum" } });
    for (const routingKey of ["catalog.refresh", "catalog.changed"]) {
      await confirmed.assertQueue(`${routingKey}.retry`, {
        durable: true,
        arguments: {
          "x-queue-type": "quorum",
          "x-message-ttl": 5000,
          "x-dead-letter-exchange": eventsExchange,
          "x-dead-letter-routing-key": routingKey,
        },
      });
      await confirmed.bindQueue(`${routingKey}.retry`, eventsExchange, `${routingKey}.retry`);
    }
    await confirmed.bindQueue("reviews.created", eventsExchange, "reviews.created");
    await confirmed.bindQueue("reviews.retry", eventsExchange, "reviews.retry");
    await confirmed.bindQueue("reviews.dlq", deadExchange, "reviews.dlq");
    await confirmed.bindQueue("catalog.dlq", deadExchange, "catalog.dlq");
    await confirmed.bindQueue("catalog.refresh", eventsExchange, "catalog.refresh");
    await confirmed.bindQueue("catalog.changed", eventsExchange, "catalog.changed");
    channel = confirmed;
    return channel;
  })().catch((error) => {
    connection = undefined;
    channel = undefined;
    setupPromise = undefined;
    throw error;
  });
  return setupPromise;
};

export const publishEvent = async (routingKey, event) => {
  const publisher = await connect();
  publisher.publish(eventsExchange, routingKey, Buffer.from(JSON.stringify(event)), {
    contentType: "application/json",
    deliveryMode: 2,
    timestamp: Date.now(),
  });
  await publisher.waitForConfirms();
};

export const closeMessaging = async () => {
  await Promise.allSettled([channel?.close(), connection ? connection.then((conn) => conn.close()) : undefined]);
  channel = undefined;
  connection = undefined;
  setupPromise = undefined;
};
