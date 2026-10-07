import { DynamoDBClient } from "@aws-sdk/client-dynamodb";

export function createDynamoClient(endpoint = process.env.DYNAMODB_ENDPOINT) {
  if (endpoint) {
    const url = new URL(endpoint);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))
      throw new Error(
        "DYNAMODB_ENDPOINT must be loopback (local development only)",
      );
  }
  return new DynamoDBClient({
    ...(endpoint
      ? {
          endpoint,
          region: process.env.AWS_REGION ?? "us-east-1",
          credentials: { accessKeyId: "local", secretAccessKey: "local" },
        }
      : {}),
    maxAttempts: 2,
  });
}
