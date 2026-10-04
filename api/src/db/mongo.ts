import { MongoClient, type Db } from 'mongodb';

let client: MongoClient | undefined;

export async function connectMongo(uri: string, dbName: string): Promise<Db> {
  client = new MongoClient(uri);
  await client.connect();
  return client.db(dbName);
}

export async function closeMongo(): Promise<void> {
  await client?.close();
  client = undefined;
}
