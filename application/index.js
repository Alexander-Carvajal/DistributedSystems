import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { metrics } from "@opentelemetry/api";
import mysql from "mysql2/promise";
import Redis from "ioredis";
import { createMongoClient } from "./db-clients.js";
import { closeMessaging, publishEvent } from "./messaging.js";

const required = (name) => {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
};

const pool = mysql.createPool({
  host: required("DB_HOST"),
  port: Number(process.env.DB_PORT || 3306),
  database: required("DB_NAME"),
  user: required("DB_USER"),
  password: required("DB_PASSWORD"),
  waitForConnections: true,
  connectionLimit: Number(process.env.DB_POOL_LIMIT || 5),
  connectTimeout: 5000,
  queueLimit: 50,
});

const mongo = createMongoClient();
const cacheRequests = metrics
  .getMeter("store-api")
  .createCounter("store.catalog.cache.requests", {
    description: "Catalog cache lookups by result",
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
  maxRetriesPerRequest: 1,
  enableOfflineQueue: false,
  retryStrategy: (attempt) => Math.min(attempt * 250, 3000),
  sentinelRetryStrategy: (attempt) => Math.min(attempt * 250, 3000),
});
redis.on("error", (error) => console.error("Redis cache unavailable:", error.message));

class HttpError extends Error {
  constructor(statusCode, message, trace) {
    super(message);
    this.statusCode = statusCode;
    this.trace = trace;
  }
}

const readJsonBody = async (request) => {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 16_384) {
      throw new HttpError(413, "Request body is too large");
    }
    chunks.push(chunk);
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new HttpError(400, "Request body must be valid JSON");
  }
};

const sendJson = (response, statusCode, payload, trace = []) => {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "x-request-trace": trace.join(" -> "),
  });
  response.end(JSON.stringify(payload));
};

const start = async () => {
  await mongo.connect();
  const reviews = mongo.db(required("MONGO_DB")).collection("product_reviews");
  const productsCacheKey = "store:products:cheapest";
  const port = Number(process.env.PORT || 8080);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("PORT must be an integer between 1 and 65535");
  }
  const server = createServer((request, response) => {
    const trace = [
      request.headers["x-presentation-lb"] || "presentation-lb-unknown",
      request.headers["x-web-node"] || "web-node-unknown",
      request.headers["x-application-lb"] || "application-lb-unknown",
      process.env.APPLICATION_NODE || "app-node-unknown",
    ];
    void (async () => {
      const pathname = new URL(request.url, "http://localhost").pathname;

      if (request.method === "GET" && pathname === "/healthz") {
        sendJson(response, 200, { status: "alive" });
        return;
      }

      if (request.method === "GET" && pathname === "/readyz") {
        const [databaseHealth, mongoHealth] = await Promise.allSettled([
          pool.query("SELECT 1"),
          mongo.db(required("MONGO_DB")).command({ ping: 1 }),
        ]);
        if (databaseHealth.status === "rejected" || mongoHealth.status === "rejected") {
          sendJson(response, 503, { status: "not ready" });
          return;
        }
        sendJson(response, 200, { status: "ready" });
        return;
      }

      if (request.method === "GET" && pathname === "/health") {
        const [databaseHealth, mongoHealth] = await Promise.allSettled([
          pool.query("SELECT 1"),
          mongo.db(required("MONGO_DB")).command({ ping: 1 }),
        ]);
        if (databaseHealth.status === "rejected" || mongoHealth.status === "rejected") {
          throw new Error("A required database dependency is unavailable");
        }
        let cache = "available";
        try {
          await redis.ping();
        } catch {
          cache = "unavailable; cache bypass enabled";
        }
        sendJson(
          response,
          200,
          { status: "ok", cache },
          [...trace, required("DB_ROUTER_NAME"), "mongodb replica set", `redis ${cache}`],
        );
        return;
      }

      if (request.method === "GET" && pathname === "/") {
        sendJson(response, 200, {
          service: "store-catalog-api",
          products: "/products/cheapest",
          reviews: "/products/{sku}/reviews",
        }, trace);
        return;
      }

      if (request.method === "GET" && pathname === "/products/cheapest") {
        trace.push("redis (cache lookup)");
        let cached;
        let cacheAvailable = true;
        try {
          cached = await redis.get(productsCacheKey);
        } catch (error) {
          cacheAvailable = false;
          trace[trace.length - 1] = "redis unavailable (cache bypass)";
          console.error("Cache lookup failed; querying Galera directly:", error.message);
        }
        if (cached) {
          cacheRequests.add(1, { result: "hit" });
          trace[trace.length - 1] = "redis (cache hit)";
          sendJson(response, 200, JSON.parse(cached), trace);
          return;
        }
        if (cacheAvailable) {
          cacheRequests.add(1, { result: "miss" });
          trace[trace.length - 1] = "redis (cache miss)";
          try {
            const refreshStarted = await redis.set(`${productsCacheKey}:refresh-lock`, "1", "EX", 5, "NX");
            if (refreshStarted === "OK") {
              await publishEvent("catalog.refresh", { schemaVersion: 1, eventId: randomUUID() });
            }
            for (let attempt = 0; attempt < 30; attempt += 1) {
              await new Promise((resolve) => setTimeout(resolve, 100));
              cached = await redis.get(productsCacheKey);
              if (cached) {
                trace[trace.length - 1] = "redis (cache refreshed by worker)";
                sendJson(response, 200, JSON.parse(cached), trace);
                return;
              }
            }
            throw new HttpError(503, "Catalog refresh is pending; retry shortly", trace);
          } catch (error) {
            if (error instanceof HttpError) throw error;
            console.error("Catalog refresh could not be queued:", error.message);
            throw new HttpError(503, "Catalog refresh is temporarily unavailable", trace);
          }
        }
        trace.push(required("DB_ROUTER_NAME"));
        const [products] = await pool.execute(
          "SELECT id, sku, name, description, price FROM products ORDER BY price ASC, id ASC LIMIT 10",
        );
        if (cacheAvailable) {
          try {
            await redis.set(productsCacheKey, JSON.stringify(products), "EX", 60);
            trace.push("redis (cache write, TTL 60s)");
          } catch (error) {
            trace.push("redis unavailable (cache write skipped)");
            console.error("Cache write failed; returning database result:", error.message);
          }
        }
        sendJson(response, 200, products, trace);
        return;
      }

      if (request.method === "POST" && pathname === "/cache/clear") {
        try {
          await publishEvent("catalog.changed", { schemaVersion: 1, eventId: randomUUID() });
        } catch {
          throw new HttpError(503, "Catalog cache invalidation could not be queued");
        }
        sendJson(
          response,
          202,
          { status: "queued", event: "catalog.changed" },
          [...trace, "rabbitmq (catalog.changed)"],
        );
        return;
      }

      const reviewMatch = pathname.match(/^\/products\/([A-Za-z0-9-]+)\/reviews$/);
      if (reviewMatch && request.method === "GET") {
        const productSku = reviewMatch[1];
        const productReviews = await reviews
          .find({ sku: productSku })
          .sort({ createdAt: -1 })
          .limit(50)
          .project({ _id: 0, reviewer: 1, rating: 1, comment: 1, createdAt: 1 })
          .toArray();
        sendJson(response, 200, { sku: productSku, reviews: productReviews }, [...trace, "mongodb"]);
        return;
      }

      if (reviewMatch && request.method === "POST") {
        if (!request.headers["content-type"]?.includes("application/json")) {
          throw new HttpError(415, "Content-Type must be application/json");
        }
        const body = await readJsonBody(request);
        if (body === null || typeof body !== "object" || Array.isArray(body)) {
          throw new HttpError(400, "Request body must be a JSON object");
        }
        const reviewer = typeof body.reviewer === "string" ? body.reviewer.trim() : "";
        const comment = typeof body.comment === "string" ? body.comment.trim() : "";
        if (
          reviewer.length < 1 ||
          reviewer.length > 80 ||
          !Number.isInteger(body.rating) ||
          body.rating < 1 ||
          body.rating > 5 ||
          comment.length < 1 ||
          comment.length > 1000
        ) {
          throw new HttpError(400, "Provide reviewer, rating (1-5), and comment within the allowed lengths");
        }
        trace.push(`${required("DB_ROUTER_NAME")} (product lookup)`);
        const [matches] = await pool.execute("SELECT 1 FROM products WHERE sku = ? LIMIT 1", [
          reviewMatch[1],
        ]);
        if (matches.length === 0) {
          throw new HttpError(404, "Product not found", trace);
        }
        const review = {
          sku: reviewMatch[1],
          reviewer,
          rating: body.rating,
          comment,
          createdAt: new Date(),
        };
        const idempotencyKey = request.headers["idempotency-key"];
        if (typeof idempotencyKey !== "string" || !/^[A-Za-z0-9._:-]{8,128}$/.test(idempotencyKey)) {
          throw new HttpError(400, "Provide an Idempotency-Key header between 8 and 128 safe characters", trace);
        }
        const existingReview = await reviews.findOne({ idempotencyKey });
        if (existingReview) {
          const { _id, idempotencyKey: _key, ...savedReview } = existingReview;
          sendJson(response, 200, { id: idempotencyKey, ...savedReview, idempotentReplay: true }, [...trace, "mongodb (idempotent replay)"]);
          return;
        }
        try {
          await publishEvent("reviews.created", {
            schemaVersion: 1,
            eventId: idempotencyKey,
            idempotencyKey,
            review,
          });
        } catch (error) {
          console.error("Review event could not be confirmed by RabbitMQ:", error.message);
          throw new HttpError(503, "Review could not be queued; retry with the same Idempotency-Key", trace);
        }
        sendJson(response, 202, { id: idempotencyKey, status: "queued" }, [...trace, "rabbitmq (reviews.created)"]);
        return;
      }

      sendJson(response, 404, { error: "Not found" }, trace);
    })().catch((error) => {
      if (!(error instanceof HttpError)) {
        console.error("Request failed:", error);
      }
      if (response.headersSent) {
        response.destroy();
        return;
      }
      sendJson(
        response,
        error instanceof HttpError ? error.statusCode : 503,
        { error: error instanceof HttpError ? error.message : "Service temporarily unavailable" },
        error instanceof HttpError && error.trace ? error.trace : trace,
      );
    });
  });

  server.listen(port, "0.0.0.0", () => {
    console.log(`Store catalog API listening on port ${port}`);
  });

  const shutdown = () => {
    server.close(() => {
        void Promise.allSettled([pool.end(), mongo.close(), redis.quit(), closeMessaging()]).then(() => process.exit(0));
    });
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
};

start().catch((error) => {
  console.error("Application startup failed:", error);
  process.exitCode = 1;
});
