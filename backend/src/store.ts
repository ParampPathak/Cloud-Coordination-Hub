import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  QueryCommand,
  TransactWriteCommand,
  DeleteCommand,
} from '@aws-sdk/lib-dynamodb';
import type { Activity } from '../../shared/types.js';
import type { Config } from './config.js';
import { normalizePoll } from './polls.js';
import type { Poll } from '../../shared/types.js';

export interface RecordVersion<T> {
  data: T;
  version: number;
}
export interface Store {
  kind: string;
  get<T>(kind: string, id: string): Promise<RecordVersion<T> | null>;
  list<T>(kind: string): Promise<T[]>;
  put<T>(
    kind: string,
    id: string,
    data: T,
    expected: number | null,
    activity?: Activity,
  ): Promise<boolean>;
  remove(kind: string, id: string): Promise<void>;
  ready(): Promise<void>;
  close(): void;
}
export class SqliteStore implements Store {
  kind = 'Local SQLite';
  private db: DatabaseSync;
  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(
      'PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS records (kind TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL, version INTEGER NOT NULL, PRIMARY KEY(kind,id));',
    );
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db.exec(
        'CREATE TABLE IF NOT EXISTS migrations (id TEXT PRIMARY KEY, applied_at TEXT NOT NULL)',
      );
      if (
        !this.db
          .prepare('SELECT id FROM migrations WHERE id=?')
          .get('001-polls')
      ) {
        const rows = this.db
          .prepare("SELECT id,data FROM records WHERE kind='poll'")
          .all();
        for (const row of rows) {
          const poll = normalizePoll(JSON.parse(String(row.data)) as Poll);
          this.db
            .prepare(
              "UPDATE records SET data=?,version=version+1 WHERE kind='poll' AND id=?",
            )
            .run(serialize(poll), row.id);
        }
        this.db
          .prepare('INSERT INTO migrations(id,applied_at) VALUES (?,?)')
          .run('001-polls', new Date().toISOString());
      }
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      this.db.close();
      throw error;
    }
  }
  async get<T>(kind: string, id: string) {
    const row = this.db
      .prepare('SELECT data,version FROM records WHERE kind=? AND id=?')
      .get(kind, id);
    return row
      ? {
          data: JSON.parse(String(row.data)) as T,
          version: Number(row.version),
        }
      : null;
  }
  async list<T>(kind: string): Promise<T[]> {
    return this.db
      .prepare('SELECT data FROM records WHERE kind=? ORDER BY id')
      .all(kind)
      .map((row) => JSON.parse(String(row.data)) as T);
  }
  async put<T>(
    kind: string,
    id: string,
    data: T,
    expected: number | null,
    activity?: Activity,
  ) {
    const json = serialize(data);
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result =
        expected === null
          ? this.db
              .prepare(
                'INSERT OR IGNORE INTO records(kind,id,data,version) VALUES (?,?,?,1)',
              )
              .run(kind, id, json)
          : this.db
              .prepare(
                'UPDATE records SET data=?,version=version+1 WHERE kind=? AND id=? AND version=?',
              )
              .run(json, kind, id, expected);
      if (Number(result.changes) === 0) {
        this.db.exec('ROLLBACK');
        return false;
      }
      if (activity)
        this.db
          .prepare('INSERT INTO records(kind,id,data,version) VALUES (?,?,?,1)')
          .run('activity', activity.id, JSON.stringify(activity));
      this.db.exec('COMMIT');
      return true;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
  async remove(kind: string, id: string) {
    this.db.prepare('DELETE FROM records WHERE kind=? AND id=?').run(kind, id);
  }
  async ready() {
    this.db.prepare('SELECT 1').get();
  }
  close() {
    this.db.close();
  }
}
function serialize(data: unknown) {
  const json = JSON.stringify(data);
  if (Buffer.byteLength(json, 'utf8') > 300_000)
    throw new Error(
      'Record size limit reached. Archive this resource before adding more entries.',
    );
  return json;
}
export class DynamoStore implements Store {
  kind: string;
  private client: DynamoDBDocumentClient;
  constructor(private config: Config) {
    // No credential provider or metadata calls in local mode.
    const local = Boolean(config.DYNAMODB_ENDPOINT);
    if (!local && config.ALLOW_AWS !== 'true')
      throw new Error('AWS access disabled.');
    this.kind = local ? 'DynamoDB Local' : 'Amazon DynamoDB';
    this.client = DynamoDBDocumentClient.from(
      new DynamoDBClient({
        region: config.AWS_REGION,
        endpoint: config.DYNAMODB_ENDPOINT,
        ...(local
          ? { credentials: { accessKeyId: 'local', secretAccessKey: 'local' } }
          : {}),
        maxAttempts: 3,
      }),
    );
  }
  async get<T>(kind: string, id: string): Promise<RecordVersion<T> | null> {
    const result = await this.client.send(
      new GetCommand({
        TableName: this.config.DYNAMODB_TABLE,
        Key: { pk: kind, sk: id },
        ConsistentRead: true,
      }),
    );
    return result.Item
      ? { data: result.Item.data as T, version: result.Item.version as number }
      : null;
  }
  async list<T>(kind: string): Promise<T[]> {
    const items: T[] = [];
    let cursor: Record<string, unknown> | undefined;
    do {
      const result = await this.client.send(
        new QueryCommand({
          TableName: this.config.DYNAMODB_TABLE,
          KeyConditionExpression: 'pk = :pk',
          ExpressionAttributeValues: { ':pk': kind },
          ConsistentRead: true,
          ExclusiveStartKey: cursor,
        }),
      );
      items.push(...(result.Items ?? []).map((item) => item.data as T));
      cursor = result.LastEvaluatedKey;
    } while (cursor);
    return items;
  }
  async put<T>(
    kind: string,
    id: string,
    data: T,
    expected: number | null,
    activity?: Activity,
  ) {
    serialize(data);
    try {
      await this.client.send(
        new TransactWriteCommand({
          TransactItems: [
            {
              Put: {
                TableName: this.config.DYNAMODB_TABLE,
                Item: {
                  pk: kind,
                  sk: id,
                  data,
                  version: (expected ?? 0) + 1,
                  ...(kind === 'session'
                    ? { expiresAt: (data as { expiresAt: number }).expiresAt }
                    : {}),
                },
                ConditionExpression:
                  expected === null ? 'attribute_not_exists(pk)' : '#v = :v',
                ...(expected === null
                  ? {}
                  : {
                      ExpressionAttributeNames: { '#v': 'version' },
                      ExpressionAttributeValues: { ':v': expected },
                    }),
              },
            },
            ...(activity
              ? [
                  {
                    Put: {
                      TableName: this.config.DYNAMODB_TABLE,
                      Item: {
                        pk: 'activity',
                        sk: activity.id,
                        data: activity,
                        version: 1,
                      },
                      ConditionExpression: 'attribute_not_exists(pk)',
                    },
                  },
                ]
              : []),
          ],
        }),
      );
      return true;
    } catch (error) {
      const e = error as {
        name: string;
        CancellationReasons?: { Code: string }[];
      };
      if (
        e.name === 'TransactionCanceledException' &&
        e.CancellationReasons?.some((reason) =>
          ['ConditionalCheckFailed', 'TransactionConflict'].includes(
            reason.Code,
          ),
        )
      )
        return false;
      throw error;
    }
  }
  async remove(kind: string, id: string) {
    await this.client.send(
      new DeleteCommand({
        TableName: this.config.DYNAMODB_TABLE,
        Key: { pk: kind, sk: id },
      }),
    );
  }
  async ready() {
    await this.get('health', 'probe');
  }
  close() {
    this.client.destroy();
  }
}
export function createStore(config: Config): Store {
  return config.DATABASE_DRIVER === 'sqlite'
    ? new SqliteStore(config.SQLITE_PATH)
    : new DynamoStore(config);
}
