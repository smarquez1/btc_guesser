// Playwright terminates its webServers with SIGKILL, so the e2e launcher's own
// SIGINT/SIGTERM cleanup cannot always run and an isolated table can be left
// behind. This teardown removes only leftover `btc-guesser-e2e-*` tables from
// the loopback DynamoDB Local instance; it never touches the configured
// development table.
import {
  DeleteTableCommand,
  ListTablesCommand,
} from "@aws-sdk/client-dynamodb";
import { createDynamoClient } from "../../src/server/persistence/client.js";

const E2E_TABLE_PREFIX = "btc-guesser-e2e-";

export default async function globalTeardown() {
  let client: ReturnType<typeof createDynamoClient>;
  try {
    client = createDynamoClient(
      process.env.DYNAMODB_ENDPOINT ?? "http://127.0.0.1:8000",
    );
  } catch (error) {
    // Non-loopback endpoints are refused by the client; nothing safe to clean.
    console.error("e2e teardown skipped: invalid DynamoDB endpoint", error);
    return;
  }
  try {
    const listed = await client.send(new ListTablesCommand({}));
    const leftovers = (listed.TableNames ?? []).filter((name) =>
      name.startsWith(E2E_TABLE_PREFIX),
    );
    for (const name of leftovers) {
      try {
        await client.send(new DeleteTableCommand({ TableName: name }), {
          abortSignal: AbortSignal.timeout(2_000),
        });
      } catch (error) {
        console.error(`Could not clean leftover e2e table ${name}`, error);
      }
    }
    if (leftovers.length > 0)
      console.info(`Removed ${leftovers.length} leftover e2e table(s)`);
  } catch (error) {
    console.error("e2e global teardown failed", error);
  } finally {
    client.destroy();
  }
}
