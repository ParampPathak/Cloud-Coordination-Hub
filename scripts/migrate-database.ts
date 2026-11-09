// Non-destructive SQLite snapshot export / resumable conditional DynamoDB import.
import { isDeepStrictEqual } from 'node:util';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';
import { readConfig } from '../backend/src/config.js';
import { DynamoStore } from '../backend/src/store.js';
const [mode, source, destination] = process.argv.slice(2);
if (!['export', 'import'].includes(mode) || !source)
  throw new Error(
    'Usage: data:migrate -- export SOURCE.sqlite BACKUP.json | import BACKUP.json [--apply]',
  );
if (mode === 'export') {
  if (!destination) throw new Error('An unused backup path is required.');
  const db = new DatabaseSync(resolve(source), { readOnly: true });
  try {
    db.exec('BEGIN');
    const records = db
      .prepare('SELECT kind,id,data FROM records ORDER BY kind,id')
      .all()
      .map((r) => ({
        kind: String(r.kind),
        id: String(r.id),
        data: JSON.parse(String(r.data)),
      }));
    db.exec('COMMIT');
    writeFileSync(
      resolve(destination),
      JSON.stringify(
        { schemaVersion: 1, exportedAt: new Date().toISOString(), records },
        null,
        2,
      ) + '\n',
      { flag: 'wx', mode: 0o600 },
    );
    console.log(
      `Exported ${records.length} records. Keep this backup private; it contains password hashes and personal information.`,
    );
  } finally {
    db.close();
  }
} else {
  const config = readConfig();
  if (config.DATABASE_DRIVER !== 'dynamodb')
    throw new Error(
      'Set DATABASE_DRIVER=dynamodb and the intended target table explicitly.',
    );
  const backup = z
    .object({
      schemaVersion: z.literal(1),
      exportedAt: z.iso.datetime(),
      records: z.array(
        z.object({
          kind: z.string().min(1).max(100),
          id: z.string().min(1).max(1000),
          data: z.unknown(),
        }),
      ),
    })
    .parse(JSON.parse(readFileSync(resolve(source), 'utf8')));
  const keys = backup.records.map((r) => JSON.stringify([r.kind, r.id]));
  if (new Set(keys).size !== keys.length)
    throw new Error('Duplicate backup keys.');
  const apply = process.argv.includes('--apply');
  if (apply && process.env.ALLOW_DATA_IMPORT !== 'true')
    throw new Error(
      'Import requires ALLOW_DATA_IMPORT=true and --apply. Default mode only compares records.',
    );
  const store = new DynamoStore(config);
  try {
    const missing = [];
    for (const record of backup.records) {
      const current = await store.get(record.kind, record.id);
      if (!current) missing.push(record);
      else if (!isDeepStrictEqual(current.data, record.data))
        throw new Error(
          `Target contains differing data for kind ${record.kind}; no existing record will be overwritten. Use a fresh target table or resolve the conflict explicitly.`,
        );
    }
    console.log(
      `${backup.records.length} source records; ${missing.length} absent from target. ${apply ? 'Import enabled.' : 'Read-only comparison; no records changed.'}`,
    );
    if (apply) {
      for (let offset = 0; offset < missing.length; offset += 10) {
        const batch = missing.slice(offset, offset + 10);
        // Each batch is atomic; previous batches remain intact if a later batch fails.
        let done = false;
        for (let attempt = 0; attempt < 8 && !done; attempt++) {
          done = await store.transact(
            batch.map((r) => ({ ...r, expected: null })),
          );
          if (!done) {
            const current = await Promise.all(
              batch.map((r) => store.get(r.kind, r.id)),
            );
            if (
              current.every(
                (r, i) => r && isDeepStrictEqual(r.data, batch[i].data),
              )
            )
              done = true;
            else if (current.some(Boolean))
              throw new Error(
                'Target changed during import. Stop application writes and rerun comparison; no existing data was overwritten.',
              );
          }
        }
        if (!done)
          throw new Error(
            'Import conflict retries exhausted. Re-run comparison to resume safely.',
          );
      }
      for (const record of backup.records) {
        const current = await store.get(record.kind, record.id);
        if (!isDeepStrictEqual(current?.data, record.data))
          throw new Error(
            'Post-import verification failed; retain source and backup.',
          );
      }
      console.log(
        'Every source record matches the target. Source database and backup were preserved.',
      );
    }
  } finally {
    store.close();
  }
}
