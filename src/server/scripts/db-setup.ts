import { createDynamoClient } from "../persistence/client.js";
import {
  ensureTable,
  requireLocalEndpoint,
} from "../persistence/local-table.js";

requireLocalEndpoint();
const table = process.env.DYNAMODB_TABLE?.trim();
if (!table) throw new Error("Set DYNAMODB_TABLE before running pnpm db:setup");
const client = createDynamoClient();
try {
  await ensureTable(client, table);
  console.info(
    `DynamoDB Local table ${table} is ready (existing data retained).`,
  );
} finally {
  client.destroy();
}
