import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { createDynamoClient } from "./client.js";
import { DynamoPlayerStore } from "./player-store.js";

export function runtimePersistence() {
  const table = process.env.DYNAMODB_TABLE?.trim();
  if (!table) return undefined;
  const client = createDynamoClient();
  return {
    store: new DynamoPlayerStore(DynamoDBDocumentClient.from(client), table),
    close: () => client.destroy(),
  };
}
