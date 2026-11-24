import { scrubSecrets, dynamoSession, isLoopback } from "./connection.ts";
import { ensureDynamoFixture } from "./fixture.ts";

const host = process.env.DASH_TEST_DYNAMODB_HOST ?? "127.0.0.1";
const port = Number(process.env.DASH_TEST_DYNAMODB_PORT ?? 8009);
const region = process.env.DASH_TEST_DYNAMODB_REGION ?? "us-east-1";
const accessKeyId = process.env.DASH_TEST_DYNAMODB_ACCESS_KEY_ID ?? "dash";
const secretAccessKey = process.env.DASH_TEST_DYNAMODB_SECRET_ACCESS_KEY ?? "dashsecret";

if (!isLoopback(host) || !Number.isInteger(port) || port < 1 || port > 65535) {
  console.error("DynamoDB fixture seed only talks to a loopback host");
  process.exit(1);
}

try {
  await ensureDynamoFixture(
    dynamoSession({
      kind: "dynamodb",
      region,
      accessKeyId,
      secretAccessKey,
      endpoint: `http://${host}:${port}`,
    }),
  );
  console.log(`DynamoDB fixture is ready at http://${host}:${port}`);
} catch (error) {
  const message = error instanceof Error ? error.message : "DynamoDB fixture seed failed";
  console.error(scrubSecrets(message, [secretAccessKey, accessKeyId]));
  process.exit(1);
}
