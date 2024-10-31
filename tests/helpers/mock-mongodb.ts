import debug from "debug";
import { MongoClient } from "mongodb";
import { MongoMemoryServer } from "mongodb-memory-server";

const log = debug("agenda:mock-mongodb");

export interface IMockMongo {
  disconnect: () => void;
  mongo: MongoClient;
  mongod: MongoMemoryServer;
  uri: string;
}

export async function mockMongo(): Promise<IMockMongo> {
  const mongod = await MongoMemoryServer.create();
  const uri = mongod.getUri();
  log("mongod started", uri);

  const mongo = await MongoClient.connect(uri);

  return {
    disconnect: async function () {
      await mongod.stop();
      log("mongod stopped");
      await mongo.close();
    },
    mongo: mongo,
    mongod: mongod,
    uri: uri,
  };
}
