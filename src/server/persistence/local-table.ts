import { setTimeout as delay } from "node:timers/promises";
import {
  CreateTableCommand,
  DescribeTableCommand,
  type DynamoDBClient,
} from "@aws-sdk/client-dynamodb";
import { isAwsError } from "./aws-error.js";

export function requireLocalEndpoint() {
  if (!process.env.DYNAMODB_ENDPOINT)
    throw new Error(
      "Set DYNAMODB_ENDPOINT to a running loopback DynamoDB Local service; copy .env.example to .env and run docker compose up -d dynamodb",
    );
}
export async function ensureTable(client: DynamoDBClient, table: string) {
  const deadline = Date.now() + 20_000;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      const result = await client.send(
        new DescribeTableCommand({ TableName: table }),
        { abortSignal: AbortSignal.timeout(2_000) },
      );
      if (result.Table?.TableStatus === "ACTIVE") return;
    } catch (error) {
      lastError = error;
      if (isAwsError(error, "ResourceNotFoundException")) {
        try {
          await client.send(
            new CreateTableCommand({
              TableName: table,
              BillingMode: "PAY_PER_REQUEST",
              AttributeDefinitions: [
                { AttributeName: "playerId", AttributeType: "S" },
              ],
              KeySchema: [{ AttributeName: "playerId", KeyType: "HASH" }],
            }),
            { abortSignal: AbortSignal.timeout(2_000) },
          );
        } catch (createError) {
          if (!isAwsError(createError, "ResourceInUseException"))
            lastError = createError;
        }
      }
    }
    await delay(200);
  }
  throw new Error(
    `DynamoDB Local table ${table} was not ready within 20 seconds; check docker compose logs dynamodb`,
    { cause: lastError },
  );
}
