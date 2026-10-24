import { MongoClient } from "mongodb";

const required = (name) => {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
};

export const createMongoClient = () => {
  const hosts = required("MONGO_HOSTS");
  const database = required("MONGO_DB");
  const replicaSet = required("MONGO_REPLICA_SET");
  const username = encodeURIComponent(required("MONGO_USER"));
  const password = encodeURIComponent(required("MONGO_PASSWORD"));
  const authDatabase = encodeURIComponent(process.env.MONGO_AUTH_DB || database);
  const uri = `mongodb://${username}:${password}@${hosts}/${encodeURIComponent(database)}?replicaSet=${encodeURIComponent(replicaSet)}&authSource=${authDatabase}&retryWrites=true&w=majority`;

  return new MongoClient(uri, {
    maxPoolSize: Number(process.env.MONGO_POOL_SIZE || 10),
    serverSelectionTimeoutMS: 10_000,
  });
};
