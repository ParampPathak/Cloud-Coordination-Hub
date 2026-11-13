// Maintenance only: stop ALL writers and back up the table before use.
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { DynamoStore } from '../backend/src/store.js';
import { readConfig } from '../backend/src/config.js';
import {
  emptySummary,
  contribution,
  type Summary,
} from '../backend/src/read-model.js';
const config = readConfig();
if (config.DATABASE_DRIVER !== 'dynamodb')
  throw new Error('This migration is for DynamoDB only.');
const store = new DynamoStore(config),
  counts = emptySummary();
try {
  for (const kind of ['event', 'poll'])
    for (const data of await store.list(kind)) {
      const part = contribution(kind, data);
      for (const key of Object.keys(counts) as (keyof Summary)[])
        counts[key] += part[key];
    }
  console.log(
    JSON.stringify({
      mode: process.argv.includes('--apply') ? 'apply' : 'preview',
      counts,
    }),
  );
  if (process.argv.includes('--apply')) {
    if (process.env.ALLOW_SUMMARY_REBUILD !== 'true')
      throw new Error(
        'Require ALLOW_SUMMARY_REBUILD=true after backup and stopping writers.',
      );
    const client = DynamoDBDocumentClient.from(
      new DynamoDBClient({
        region: config.AWS_REGION,
        endpoint: config.DYNAMODB_ENDPOINT,
        ...(config.DYNAMODB_ENDPOINT
          ? { credentials: { accessKeyId: 'local', secretAccessKey: 'local' } }
          : {}),
      }),
    );
    try {
      for (const activity of await store.list<
        import('../shared/types.js').Activity
      >('activity')) {
        let owner: string | undefined;
        for (const kind of ['event', 'poll', 'slot']) {
          const entity = await store.get<{ organizerId: string }>(
            kind,
            activity.resourceId,
          );
          if (entity) {
            owner = entity.data.organizerId;
            break;
          }
        }
        for (const recipient of new Set(
          [activity.actorId, owner].filter(Boolean),
        ))
          await client.send(
            new PutCommand({
              TableName: config.DYNAMODB_TABLE,
              Item: {
                pk: `activity-user:${recipient}`,
                sk: activity.id,
                data: activity,
                version: 1,
              },
            }),
          );
      }
      await client.send(
        new PutCommand({
          TableName: config.DYNAMODB_TABLE,
          Item: { pk: 'summary', sk: 'v1', ...counts },
        }),
      );
    } finally {
      client.destroy();
    }
  }
} finally {
  store.close();
}
