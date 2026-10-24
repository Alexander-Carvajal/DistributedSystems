const replicaSetName = "store-rs";
const databaseName = process.env.MONGO_DB_NAME;
const applicationUsername = process.env.MONGO_APP_USERNAME;
const applicationPassword = process.env.MONGO_APP_PASSWORD;

if (!databaseName || !applicationUsername || !applicationPassword) {
  throw new Error("MongoDB application user environment is incomplete");
}

try {
  rs.status();
  print(`Replica set ${replicaSetName} is already initialized`);
} catch (error) {
  print(`Initializing replica set ${replicaSetName}`);
  rs.initiate({
    _id: replicaSetName,
    members: [
      { _id: 0, host: "mongodb1:27017", priority: 2 },
      { _id: 1, host: "mongodb2:27017", priority: 1 },
      { _id: 2, host: "mongodb3:27017", priority: 1 },
    ],
  });
}

const deadline = Date.now() + 90000;
let isPrimary = false;
while (Date.now() < deadline) {
  try {
    isPrimary = db.adminCommand({ hello: 1 }).isWritablePrimary === true;
  } catch (error) {
    isPrimary = false;
  }
  if (isPrimary) break;
  sleep(1000);
}

if (!isPrimary) {
  throw new Error("MongoDB replica set did not elect a primary within 90 seconds");
}

const applicationDb = db.getSiblingDB(databaseName);
if (!applicationDb.getUser(applicationUsername)) {
  applicationDb.createUser({
    user: applicationUsername,
    pwd: applicationPassword,
    roles: [{ role: "readWrite", db: databaseName }],
  });
  print(`Created least-privilege user for ${databaseName}`);
} else {
  print(`Application user already exists in ${databaseName}`);
}
