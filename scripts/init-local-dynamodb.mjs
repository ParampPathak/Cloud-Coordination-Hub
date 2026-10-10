import {
  DynamoDBClient,
  CreateTableCommand,
  DescribeTableCommand,
} from '@aws-sdk/client-dynamodb';
const endpoint = process.env.DYNAMODB_ENDPOINT ?? 'http://127.0.0.1:8000';
const url = new URL(endpoint);
if (
  !['localhost', '127.0.0.1', 'dynamodb', '[::1]'].includes(url.hostname) ||
  url.protocol !== 'http:'
)
  throw new Error('This script only initializes local DynamoDB.');
const client = new DynamoDBClient({
  endpoint,
  region: 'us-east-1',
  credentials: { accessKeyId: 'local', secretAccessKey: 'local' },
  maxAttempts: 1,
});
const TableName = process.env.DYNAMODB_TABLE ?? 'cloud-coordination-local';
for (let i = 0; i < 30; i++) {
  try {
    try {
      await client.send(new DescribeTableCommand({ TableName }));
    } catch (e) {
      if (e.name !== 'ResourceNotFoundException') throw e;
      await client.send(
        new CreateTableCommand({
          TableName,
          KeySchema: [
            { AttributeName: 'pk', KeyType: 'HASH' },
            { AttributeName: 'sk', KeyType: 'RANGE' },
          ],
          AttributeDefinitions: [
            { AttributeName: 'pk', AttributeType: 'S' },
            { AttributeName: 'sk', AttributeType: 'S' },
          ],
          BillingMode: 'PAY_PER_REQUEST',
        }),
      );
    }
    console.log(`Local DynamoDB table ready: ${TableName}`);
    client.destroy();
    process.exit(0);
  } catch (e) {
    if (i === 29) throw e;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}
