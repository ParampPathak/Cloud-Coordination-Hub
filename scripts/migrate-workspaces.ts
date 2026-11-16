import { DatabaseSync } from 'node:sqlite';
import { existsSync } from 'node:fs';
import { readConfig } from '../backend/src/config.js';
import { postgresPool } from '../backend/src/postgres-store.js';
import {
  planWorkspaceMigration,
  type MigrationRow,
} from '../backend/src/workspace-migration.js';

const [ownerEmail, mode] = process.argv.slice(2);
if (!ownerEmail || (mode !== undefined && mode !== '--apply'))
  throw new Error('Usage: migrate-workspaces <existing-owner-email> [--apply]');
const apply = mode === '--apply';
if (apply && process.env.ALLOW_WORKSPACE_MIGRATION !== 'true')
  throw new Error(
    'Apply requires ALLOW_WORKSPACE_MIGRATION=true after backup and writer shutdown.',
  );
const config = readConfig();
function report(
  plan: ReturnType<typeof planWorkspaceMigration>,
  before: number,
) {
  console.log(
    JSON.stringify(
      {
        mode: apply ? 'apply' : 'dry-run',
        alreadyMigrated: plan.alreadyMigrated,
        existingCount: before,
        counts: plan.counts,
        addedRecords: plan.additions.length,
      },
      null,
      2,
    ),
  );
}
if (config.DATABASE_DRIVER === 'sqlite') {
  if (!existsSync(config.SQLITE_PATH))
    throw new Error(
      'Initialize a local SQLite file and provision its owner first.',
    );
  const db = new DatabaseSync(config.SQLITE_PATH, { readOnly: !apply });
  try {
    db.exec(apply ? 'BEGIN IMMEDIATE' : 'BEGIN');
    const raw = db.prepare('SELECT kind,id,data,version FROM records').all();
    const rows = raw.map((r) => ({
      ...r,
      data: JSON.parse(String(r.data)),
    })) as MigrationRow[];
    const plan = planWorkspaceMigration(rows, ownerEmail);
    if (apply) {
      const insert = db.prepare(
        'INSERT INTO records(kind,id,data,version) VALUES(?,?,?,1)',
      );
      for (const row of plan.additions)
        insert.run(row.kind, row.id, JSON.stringify(row.data));
      const count = db.prepare('SELECT COUNT(*) AS n FROM records').get()!;
      if (Number(count.n) !== rows.length + plan.additions.length)
        throw new Error('Unexpected record count.');
    }
    db.exec(apply ? 'COMMIT' : 'ROLLBACK');
    report(plan, rows.length);
  } finally {
    db.close();
  }
} else if (config.DATABASE_DRIVER === 'postgres') {
  const pool = postgresPool(config);
  try {
    const client = await pool.connect();
    try {
      await client.query(
        apply ? 'BEGIN' : 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY',
      );
      if (apply)
        await client.query(
          'LOCK TABLE cch.records IN SHARE ROW EXCLUSIVE MODE',
        );
      const versions = (
        await client.query('SELECT version FROM cch.schema_version')
      ).rows;
      if (versions.length !== 1 || versions[0].version !== 1)
        throw new Error('Unsupported PostgreSQL schema version.');
      const rows = (
        await client.query<MigrationRow>(
          'SELECT kind,id,data,version FROM cch.records',
        )
      ).rows;
      const plan = planWorkspaceMigration(rows, ownerEmail);
      if (apply) {
        for (const row of plan.additions)
          await client.query(
            'INSERT INTO cch.records(kind,id,data,version) VALUES($1,$2,$3::jsonb,1)',
            [row.kind, row.id, JSON.stringify(row.data)],
          );
        const count = (
          await client.query('SELECT COUNT(*) AS n FROM cch.records')
        ).rows[0].n;
        if (Number(count) !== rows.length + plan.additions.length)
          throw new Error('Unexpected record count.');
      }
      await client.query(apply ? 'COMMIT' : 'ROLLBACK');
      report(plan, rows.length);
    } catch (error) {
      await client.query('ROLLBACK');
      // PostgreSQL driver detail may contain raw data values.
      if (error instanceof Error && !('code' in error)) throw error;
      console.error(
        'PostgreSQL workspace migration failed. Database operation failed.',
      );
      process.exitCode = 1;
    } finally {
      client.release();
    }
  } finally {
    await pool.end();
  }
} else {
  throw new Error(
    'Explicit workspace migration supports SQLite and PostgreSQL.',
  );
}
