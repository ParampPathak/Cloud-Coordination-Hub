import { Pool, type PoolClient } from 'pg';
import { readFileSync } from 'node:fs';
import type { Config } from './config.js';
import type { Activity } from '../../shared/types.js';
import type { Store, StoreWrite, RecordVersion, Page } from './store.js';
import { activityRecipients, serialize, validateWrites } from './store.js';
import { contribution, emptySummary, type Summary } from './read-model.js';
import { HttpError } from './errors.js';

export function postgresPool(config: Config) {
  // Config rejects URL query options, which could override verified TLS in pg.
  const pool = new Pool({
    connectionString: config.POSTGRES_URL,
    ssl:
      config.POSTGRES_SSL === 'verify-full'
        ? {
            ca: readFileSync(config.POSTGRES_CA_FILE!, 'utf8'),
            rejectUnauthorized: true,
          }
        : false,
    max: config.POSTGRES_POOL_MAX,
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 30000,
    statement_timeout: 10000,
    idle_in_transaction_session_timeout: 15000,
    application_name: 'cloud-coordination-hub',
  });
  // Never log connection strings, SQL parameters or driver error details.
  pool.on('error', () =>
    console.error(
      JSON.stringify({
        level: 'error',
        category: 'DatabaseFailure',
        message: 'PostgreSQL idle connection failed',
      }),
    ),
  );
  return pool;
}
const retryable = (error: unknown) =>
  ['40001', '40P01', '55P03'].includes((error as { code?: string }).code ?? '');
export class PostgresStore implements Store {
  readonly kind = 'PostgreSQL';
  private readonly pool: Pool;
  private cleanupTimer?: ReturnType<typeof setInterval>;
  constructor(config: Config) {
    this.pool = postgresPool(config);
  }
  async ready() {
    const result = await this.pool.query(
      'SELECT version FROM cch.schema_version WHERE version=1',
    );
    if (result.rowCount !== 1)
      throw new Error('PostgreSQL schema migration required.');
    const summary = await this.pool.query(
      'SELECT id FROM cch.summary WHERE id=1',
    );
    if (summary.rowCount !== 1)
      throw new Error('PostgreSQL summary initialization required.');
  }
  async get<T>(kind: string, id: string): Promise<RecordVersion<T> | null> {
    const { rows } = await this.pool.query(
      'SELECT data,version FROM cch.records WHERE kind=$1 AND id=$2',
      [kind, id],
    );
    return rows.length
      ? { data: rows[0].data as T, version: Number(rows[0].version) }
      : null;
  }
  async summary(): Promise<Summary> {
    const { rows } = await this.pool.query(
      'SELECT events,confirmed,waitlisted,"activePolls" FROM cch.summary WHERE id=1',
    );
    if (!rows.length)
      throw new Error('PostgreSQL summary initialization required.');
    return rows[0] as Summary;
  }
  async page<T>(
    kind: string,
    limit: number,
    after = '',
    descending = false,
  ): Promise<Page<T>> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 50)
      throw new HttpError(400, 'Page limit must be 1-50.');
    const { rows } = await this.pool.query(
      `SELECT id,data FROM cch.records WHERE kind=$1 ${after ? `AND id ${descending ? '<' : '>'} $3` : ''} ORDER BY id ${descending ? 'DESC' : 'ASC'} LIMIT $2`,
      after ? [kind, limit + 1, after] : [kind, limit + 1],
    );
    const selected = rows.slice(0, limit);
    return {
      items: selected.map((row) => row.data as T),
      nextCursor: rows.length > limit ? selected.at(-1)!.id : null,
      examined: rows.length,
    };
  }
  async list<T>(kind: string): Promise<T[]> {
    const { rows } = await this.pool.query(
      'SELECT data FROM cch.records WHERE kind=$1 ORDER BY id',
      [kind],
    );
    return rows.map((row) => row.data as T);
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
  private async updateSummary(client: PoolClient, delta: Summary) {
    if (!Object.values(delta).some(Boolean)) return;
    const result = await client.query(
      'UPDATE cch.summary SET events=events+$1,confirmed=confirmed+$2,waitlisted=waitlisted+$3,"activePolls"="activePolls"+$4 WHERE id=1',
      [delta.events, delta.confirmed, delta.waitlisted, delta.activePolls],
    );
    if (result.rowCount !== 1)
      throw new Error('PostgreSQL summary initialization required.');
  }
  async transact(writes: StoreWrite[], activity?: Activity): Promise<boolean> {
    validateWrites(writes, activity);
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const delta = emptySummary();
      // Stable ordering reduces deadlocks. CAS remains authoritative across pools/hosts.
      const ordered = [...writes].sort((a, b) =>
        a.kind < b.kind
          ? -1
          : a.kind > b.kind
            ? 1
            : a.id < b.id
              ? -1
              : a.id > b.id
                ? 1
                : 0,
      );
      for (const write of ordered) {
        const { kind, id, data, expected } = write;
        const json = serialize(data);
        const prior = await client.query(
          'SELECT data,version FROM cch.records WHERE kind=$1 AND id=$2 FOR UPDATE',
          [kind, id],
        );
        if (
          expected === null
            ? prior.rowCount !== 0
            : !prior.rowCount || Number(prior.rows[0].version) !== expected
        ) {
          await client.query('ROLLBACK');
          return false;
        }
        const result =
          expected === null
            ? await client.query(
                'INSERT INTO cch.records(kind,id,data,version) VALUES($1,$2,$3::jsonb,1) ON CONFLICT DO NOTHING',
                [kind, id, json],
              )
            : await client.query(
                'UPDATE cch.records SET data=$3::jsonb,version=version+1 WHERE kind=$1 AND id=$2 AND version=$4',
                [kind, id, json, expected],
              );
        if (result.rowCount !== 1) {
          await client.query('ROLLBACK');
          return false;
        }
        const before = contribution(kind, prior.rows[0]?.data),
          after = contribution(kind, data);
        for (const key of Object.keys(delta) as (keyof Summary)[])
          delta[key] += after[key] - before[key];
      }
      if (activity) {
        for (const kind of [
          'activity',
          ...activityRecipients(writes, activity).map(
            (id) => `activity-user:${id}`,
          ),
        ])
          await client.query(
            'INSERT INTO cch.records(kind,id,data,version) VALUES($1,$2,$3::jsonb,1)',
            [kind, activity.id, serialize(activity)],
          );
      }
      await this.updateSummary(client, delta);
      await client.query('COMMIT');
      return true;
    } catch (error) {
      await client.query('ROLLBACK');
      if (retryable(error)) return false;
      throw error;
    } finally {
      client.release();
    }
  }
  async remove(kind: string, id: string) {
    for (let attempt = 0; attempt < 8; attempt++) {
      const client = await this.pool.connect();
      try {
        await client.query('BEGIN');
        const result = await client.query(
          'DELETE FROM cch.records WHERE kind=$1 AND id=$2 RETURNING data',
          [kind, id],
        );
        if (result.rowCount) {
          const before = contribution(kind, result.rows[0].data),
            delta = emptySummary();
          for (const key of Object.keys(delta) as (keyof Summary)[])
            delta[key] = -before[key];
          await this.updateSummary(client, delta);
        }
        await client.query('COMMIT');
        return;
      } catch (error) {
        await client.query('ROLLBACK');
        if (!retryable(error) || attempt === 7) throw error;
      } finally {
        client.release();
      }
    }
  }
  async cleanupSessions(now = Math.floor(Date.now() / 1000)) {
    const result = await this.pool.query(
      `DELETE FROM cch.records WHERE kind='session' AND id IN (SELECT id FROM cch.records WHERE kind='session' AND (data->>'expiresAt')::bigint <= $1 ORDER BY (data->>'expiresAt')::bigint LIMIT 500 FOR UPDATE SKIP LOCKED)`,
      [now],
    );
    return result.rowCount ?? 0;
  }
  startSessionCleanup(seconds: number) {
    if (this.cleanupTimer) return;
    const cleanup = () => {
      void this.cleanupSessions().catch(() =>
        console.warn(
          JSON.stringify({
            level: 'warn',
            category: 'SessionCleanupFailure',
            message: 'PostgreSQL session cleanup deferred',
          }),
        ),
      );
    };
    cleanup();
    this.cleanupTimer = setInterval(cleanup, seconds * 1000);
    this.cleanupTimer.unref();
  }
  async close() {
    clearInterval(this.cleanupTimer);
    await this.pool.end();
  }
}
