import { contribution, emptySummary, type Summary } from './read-model.js';
import { HttpError } from './errors.js';
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
  PutCommand,
} from '@aws-sdk/lib-dynamodb';
import type { Activity } from '../../shared/types.js';
import type { Config } from './config.js';
import { normalizePoll } from './polls.js';
import type { Poll } from '../../shared/types.js';

export interface RecordVersion<T> {
  data: T;
  version: number;
}
export interface Page<T> {
  items: T[];
  nextCursor: string | null;
  examined: number;
}
export interface Store {
  kind: string;
  summary(): Promise<Summary>;
  page<T>(
    kind: string,
    limit: number,
    after?: string,
    descending?: boolean,
  ): Promise<Page<T>>;
  transact(writes: StoreWrite[], activity?: Activity): Promise<boolean>;
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
export interface StoreWrite {
  kind: string;
  id: string;
  data: unknown;
  expected: number | null;
}
function validateWrites(writes: StoreWrite[], activity?: Activity) {
  if (
    !writes.length ||
    writes.length +
      (activity ? 1 + activityRecipients(writes, activity).length : 0) +
      Number(writes.some((w) => ['event', 'poll'].includes(w.kind))) >
      100
  )
    throw new Error('Transaction must contain 1–100 items.');
  const keys = writes.map((w) => JSON.stringify([w.kind, w.id]));
  if (new Set(keys).size !== keys.length)
    throw new Error('Duplicate transaction key.');
  let size = 0;
  for (const w of writes) size += Buffer.byteLength(serialize(w.data)) + 1024;
  if (size > 3_900_000) throw new Error('Transaction size limit reached.');
}
export function activityRecipients(writes: StoreWrite[], activity: Activity) {
  const entity = writes.find((w) => w.id === activity.resourceId)?.data as
    { organizerId?: string } | undefined;
  return [
    ...new Set(
      [activity.actorId, entity?.organizerId].filter((id): id is string =>
        Boolean(id),
      ),
    ),
  ];
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
    this.db.exec(
      "CREATE INDEX IF NOT EXISTS session_expiry ON records(json_extract(data,'$.expiresAt')) WHERE kind='session'",
    );
    this.db.exec(
      'CREATE TABLE IF NOT EXISTS hub_summary (id INTEGER PRIMARY KEY CHECK(id=1), data TEXT NOT NULL)',
    );
    if (!this.db.prepare('SELECT id FROM hub_summary WHERE id=1').get())
      this.db
        .prepare('INSERT OR IGNORE INTO hub_summary(id,data) VALUES (1,?)')
        .run(JSON.stringify(this.calculateSummary()));
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
      if (
        !this.db
          .prepare('SELECT id FROM migrations WHERE id=?')
          .get('002-activity-scope')
      ) {
        for (const row of this.db
          .prepare("SELECT data FROM records WHERE kind='activity'")
          .all()) {
          const activity = JSON.parse(String(row.data)) as Activity;
          let owner: string | undefined;
          for (const kind of ['event', 'poll', 'slot']) {
            const entity = this.db
              .prepare('SELECT data FROM records WHERE kind=? AND id=?')
              .get(kind, activity.resourceId);
            if (entity) {
              owner = JSON.parse(String(entity.data)).organizerId;
              break;
            }
          }
          for (const recipient of new Set(
            [activity.actorId, owner].filter(Boolean),
          ))
            this.db
              .prepare(
                'INSERT OR IGNORE INTO records(kind,id,data,version) VALUES (?,?,?,1)',
              )
              .run(
                `activity-user:${recipient}`,
                activity.id,
                JSON.stringify(activity),
              );
        }
        this.db
          .prepare('INSERT INTO migrations(id,applied_at) VALUES (?,?)')
          .run('002-activity-scope', new Date().toISOString());
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
  private calculateSummary(): Summary {
    const result = emptySummary();
    const counts = this.db
      .prepare(
        `SELECT count(*) AS events, coalesce(sum((SELECT count(*) FROM json_each(records.data,'$.registrations') WHERE json_extract(value,'$.status')='confirmed')),0) AS confirmed, coalesce(sum((SELECT count(*) FROM json_each(records.data,'$.registrations') WHERE json_extract(value,'$.status')='waitlisted')),0) AS waitlisted FROM records WHERE kind='event'`,
      )
      .get()!;
    result.events = Number(counts.events);
    result.confirmed = Number(counts.confirmed);
    result.waitlisted = Number(counts.waitlisted);
    result.activePolls = Number(
      this.db
        .prepare(
          `SELECT count(*) AS n FROM records WHERE kind='poll' AND coalesce(json_extract(data,'$.settings.state'),'open') NOT IN ('draft','archived') AND json_extract(data,'$.closed')=0`,
        )
        .get()!.n,
    );
    return result;
  }
  async summary(): Promise<Summary> {
    return JSON.parse(
      String(
        this.db.prepare('SELECT data FROM hub_summary WHERE id=1').get()!.data,
      ),
    ) as Summary;
  }
  async page<T>(
    kind: string,
    limit: number,
    after = '',
    descending = false,
  ): Promise<Page<T>> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 50)
      throw new HttpError(400, 'Page limit must be 1–50.');
    const op = descending ? '<' : '>';
    const rows = this.db
      .prepare(
        `SELECT id,data FROM records WHERE kind=? ${after ? `AND id ${op} ?` : ''} ORDER BY id ${descending ? 'DESC' : 'ASC'} LIMIT ?`,
      )
      .all(...(after ? [kind, after, limit + 1] : [kind, limit + 1]));
    const selected = rows.slice(0, limit);
    return {
      items: selected.map((row) => JSON.parse(String(row.data)) as T),
      nextCursor: rows.length > limit ? String(selected.at(-1)!.id) : null,
      examined: rows.length,
    };
  }
  cleanupSessions(now = Math.floor(Date.now() / 1000)) {
    return Number(
      this.db
        .prepare(
          "DELETE FROM records WHERE kind='session' AND id IN (SELECT id FROM records WHERE kind='session' AND json_extract(data,'$.expiresAt') <= ? LIMIT 500)",
        )
        .run(now).changes,
    );
  }
  startSessionCleanup(seconds: number) {
    if (this.cleanupTimer) return;
    this.cleanupSessions();
    this.cleanupTimer = setInterval(() => {
      try {
        this.cleanupSessions();
      } catch {
        console.warn(
          JSON.stringify({
            level: 'warn',
            category: 'SessionCleanupFailure',
            message: 'Session cleanup deferred until next maintenance interval',
          }),
        );
      }
    }, seconds * 1000);
    this.cleanupTimer.unref();
  }
  private cleanupTimer?: ReturnType<typeof setInterval>;
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
    return this.transact([{ kind, id, data, expected }], activity);
  }
  async transact(writes: StoreWrite[], activity?: Activity) {
    validateWrites(writes, activity);
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const counts = JSON.parse(
        String(
          this.db.prepare('SELECT data FROM hub_summary WHERE id=1').get()!
            .data,
        ),
      ) as Summary;
      for (const write of writes.filter((w) =>
        ['event', 'poll'].includes(w.kind),
      )) {
        const row = this.db
          .prepare('SELECT data FROM records WHERE kind=? AND id=?')
          .get(write.kind, write.id);
        const prior = row ? { data: JSON.parse(String(row.data)) } : null;
        const before = contribution(write.kind, prior?.data),
          after = contribution(write.kind, write.data);
        for (const key of Object.keys(counts) as (keyof Summary)[])
          counts[key] += after[key] - before[key];
      }
      for (const { kind, id, data, expected } of writes) {
        const json = serialize(data);
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
      }
      if (activity)
        this.db
          .prepare('INSERT INTO records(kind,id,data,version) VALUES (?,?,?,1)')
          .run('activity', activity.id, JSON.stringify(activity));
      if (activity)
        for (const recipient of activityRecipients(writes, activity)) {
          this.db
            .prepare(
              'INSERT INTO records(kind,id,data,version) VALUES (?,?,?,1)',
            )
            .run(
              `activity-user:${recipient}`,
              activity.id,
              JSON.stringify(activity),
            );
        }
      this.db
        .prepare('UPDATE hub_summary SET data=? WHERE id=1')
        .run(JSON.stringify(counts));
      this.db.exec('COMMIT');
      return true;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
  async remove(kind: string, id: string) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const row = this.db
        .prepare('SELECT data FROM records WHERE kind=? AND id=?')
        .get(kind, id);
      if (row && ['event', 'poll'].includes(kind)) {
        const counts = JSON.parse(
          String(
            this.db.prepare('SELECT data FROM hub_summary WHERE id=1').get()!
              .data,
          ),
        ) as Summary;
        const before = contribution(kind, JSON.parse(String(row.data)));
        for (const key of Object.keys(counts) as (keyof Summary)[])
          counts[key] -= before[key];
        this.db
          .prepare('UPDATE hub_summary SET data=? WHERE id=1')
          .run(JSON.stringify(counts));
      }
      this.db
        .prepare('DELETE FROM records WHERE kind=? AND id=?')
        .run(kind, id);
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
  async ready() {
    this.db.prepare('SELECT 1').get();
  }
  close() {
    clearInterval(this.cleanupTimer);
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
  private summaryInitialized = false;
  private async ensureSummary() {
    if (this.summaryInitialized) return;
    const existing = await this.client.send(
      new GetCommand({
        TableName: this.config.DYNAMODB_TABLE,
        Key: { pk: 'summary', sk: 'v1' },
        ConsistentRead: true,
      }),
    );
    if (!existing.Item) {
      for (const kind of ['event', 'poll']) {
        const probe = await this.page(kind, 1);
        if (probe.items.length)
          throw new HttpError(
            503,
            'Read model migration required. Ask the project administrator.',
          );
      }
      try {
        await this.client.send(
          new PutCommand({
            TableName: this.config.DYNAMODB_TABLE,
            Item: { pk: 'summary', sk: 'v1', ...emptySummary() },
            ConditionExpression: 'attribute_not_exists(pk)',
          }),
        );
      } catch (error) {
        if ((error as Error).name !== 'ConditionalCheckFailedException')
          throw error;
      }
    }
    this.summaryInitialized = true;
  }
  async summary(): Promise<Summary> {
    await this.ensureSummary();
    const result = await this.client.send(
      new GetCommand({
        TableName: this.config.DYNAMODB_TABLE,
        Key: { pk: 'summary', sk: 'v1' },
        ConsistentRead: true,
      }),
    );
    return {
      ...emptySummary(),
      ...Object.fromEntries(
        Object.keys(emptySummary()).map((key) => [
          key,
          Number(result.Item?.[key] ?? 0),
        ]),
      ),
    };
  }
  async page<T>(
    kind: string,
    limit: number,
    after = '',
    descending = false,
  ): Promise<Page<T>> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 50)
      throw new HttpError(400, 'Page limit must be 1–50.');
    const result = await this.client.send(
      new QueryCommand({
        TableName: this.config.DYNAMODB_TABLE,
        KeyConditionExpression: 'pk = :pk',
        ExpressionAttributeValues: { ':pk': kind },
        Limit: limit,
        ConsistentRead: true,
        ScanIndexForward: !descending,
        ...(after ? { ExclusiveStartKey: { pk: kind, sk: after } } : {}),
      }),
    );
    return {
      items: (result.Items ?? []).map((item) => item.data as T),
      nextCursor: result.LastEvaluatedKey
        ? String(result.LastEvaluatedKey.sk)
        : null,
      examined: result.ScannedCount ?? 0,
    };
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
    return this.transact([{ kind, id, data, expected }], activity);
  }
  async transact(writes: StoreWrite[], activity?: Activity) {
    validateWrites(writes, activity);
    const delta = emptySummary();
    if (writes.some((w) => ['event', 'poll'].includes(w.kind))) {
      await this.ensureSummary();
      for (const w of writes.filter((w) =>
        ['event', 'poll'].includes(w.kind),
      )) {
        const previous = await this.get(w.kind, w.id);
        if ((previous?.version ?? null) !== w.expected) return false;
        const before = contribution(w.kind, previous?.data),
          after = contribution(w.kind, w.data);
        for (const key of Object.keys(delta) as (keyof Summary)[])
          delta[key] += after[key] - before[key];
      }
    }
    try {
      await this.client.send(
        new TransactWriteCommand({
          TransactItems: [
            ...(activity
              ? activityRecipients(writes, activity).map((recipient) => ({
                  Put: {
                    TableName: this.config.DYNAMODB_TABLE,
                    Item: {
                      pk: `activity-user:${recipient}`,
                      sk: activity.id,
                      data: activity,
                      version: 1,
                    },
                    ConditionExpression: 'attribute_not_exists(pk)',
                  },
                }))
              : []),

            ...(Object.values(delta).some(Boolean)
              ? [
                  {
                    Update: {
                      TableName: this.config.DYNAMODB_TABLE,
                      Key: { pk: 'summary', sk: 'v1' },
                      UpdateExpression: 'ADD #e :e, #c :c, #w :w, #p :p',
                      ExpressionAttributeNames: {
                        '#e': 'events',
                        '#c': 'confirmed',
                        '#w': 'waitlisted',
                        '#p': 'activePolls',
                      },
                      ExpressionAttributeValues: {
                        ':e': delta.events,
                        ':c': delta.confirmed,
                        ':w': delta.waitlisted,
                        ':p': delta.activePolls,
                      },
                    },
                  },
                ]
              : []),

            ...writes.map(({ kind, id, data, expected }) => ({
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
            })),
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
        e.name === 'TransactionConflictException' ||
        (e.name === 'TransactionCanceledException' &&
          e.CancellationReasons?.some((reason) =>
            ['ConditionalCheckFailed', 'TransactionConflict'].includes(
              reason.Code,
            ),
          ) &&
          e.CancellationReasons.every((reason) =>
            ['None', 'ConditionalCheckFailed', 'TransactionConflict'].includes(
              reason.Code,
            ),
          ))
      )
        return false;
      throw error;
    }
  }
  async remove(kind: string, id: string) {
    if (!['event', 'poll'].includes(kind)) {
      await this.client.send(
        new DeleteCommand({
          TableName: this.config.DYNAMODB_TABLE,
          Key: { pk: kind, sk: id },
        }),
      );
      return;
    }
    await this.ensureSummary();
    for (let attempt = 0; attempt < 32; attempt++) {
      const record = await this.get(kind, id);
      if (!record) return;
      const delta = contribution(kind, record.data);
      try {
        await this.client.send(
          new TransactWriteCommand({
            TransactItems: [
              {
                Delete: {
                  TableName: this.config.DYNAMODB_TABLE,
                  Key: { pk: kind, sk: id },
                  ConditionExpression: '#v=:v',
                  ExpressionAttributeNames: { '#v': 'version' },
                  ExpressionAttributeValues: { ':v': record.version },
                },
              },
              {
                Update: {
                  TableName: this.config.DYNAMODB_TABLE,
                  Key: { pk: 'summary', sk: 'v1' },
                  UpdateExpression: 'ADD #e :e, #c :c, #w :w, #p :p',
                  ExpressionAttributeNames: {
                    '#e': 'events',
                    '#c': 'confirmed',
                    '#w': 'waitlisted',
                    '#p': 'activePolls',
                  },
                  ExpressionAttributeValues: {
                    ':e': -delta.events,
                    ':c': -delta.confirmed,
                    ':w': -delta.waitlisted,
                    ':p': -delta.activePolls,
                  },
                },
              },
            ],
          }),
        );
        return;
      } catch (error) {
        if (
          ![
            'TransactionCanceledException',
            'TransactionConflictException',
          ].includes((error as Error).name)
        )
          throw error;
      }
    }
    throw new Error('Resource changed repeatedly during removal.');
  }
  async ready() {
    await this.get('health', 'probe');
    await this.ensureSummary();
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
