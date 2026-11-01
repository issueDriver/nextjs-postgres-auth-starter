import nextEnv from '@next/env';
import postgres from 'postgres';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { databaseConfig } from '../lib/db/config.mjs';
import {
  inspectDatabase,
  loadMigrations,
  MigrationError,
  migrationStatus,
  postgresDatabase,
  runMigrations,
} from './lib/migrations.mjs';

const mode = process.argv[2];
const validModes = ['check', 'status', 'migrate', 'backup'];
const quiet = { info() {}, error() {} };

let client;
try {
  if (!validModes.includes(mode)) {
    throw new MigrationError('INVALID_COMMAND', 'Use check, status, migrate, or backup.');
  }

  nextEnv.loadEnvConfig(process.cwd(), process.env.NODE_ENV !== 'production', quiet);
  const { connectionString, source, options } = databaseConfig(process.env, { migration: true });
  const target = new URL(connectionString);
  const fingerprint = createHash('sha256').update(`${target.hostname}:${target.port}${target.pathname}`).digest('hex').slice(0, 12);
  console.log(`Database target: ${source}, fingerprint ${fingerprint}.`);

  client = postgres(connectionString, options);
  const database = postgresDatabase(client);
  const migrations = await loadMigrations();

  if (mode === 'backup') {
    const [table] = await database.query("SELECT to_regclass('public.books') IS NOT NULL AS exists");
    const books = table.exists
      ? await database.query('SELECT id::text, "bookId", "wordCount", "updatedAt"::text FROM public.books ORDER BY "bookId"')
      : [];
    await mkdir('backups', { recursive: true, mode: 0o700 });
    const filename = path.join('backups', `migration-metadata-${Date.now()}-${fingerprint}.json`);
    await writeFile(filename, JSON.stringify({ formatVersion: 1, createdAt: new Date().toISOString(), fingerprint, books }, null, 2), { flag: 'wx', mode: 0o600 });
    console.log(`Saved metadata for ${books.length} books to ${filename}. This is not a full database backup.`);
  } else if (mode === 'migrate') {
    const applied = await runMigrations(database, migrations);
    console.log(applied.length ? `Applied: ${applied.join(', ')}` : 'Database is already up to date.');
  } else {
    const result = mode === 'check'
      ? await inspectDatabase(database, migrations)
      : await migrationStatus(database, migrations);
    console.log(JSON.stringify(result, null, 2));
    if (mode === 'check' && (
      Number(result.accounts?.invalid_rows ?? 0) > 0
      || Number(result.accounts?.duplicate_email_groups ?? 0) > 0
      || Number(result.studySequence?.invalid_books ?? 0) > 0
    )) process.exitCode = 1;
  }
} catch (error) {
  // Driver error detail can contain credentials or row values; only print safe codes.
  if (error instanceof MigrationError) {
    console.error(`${error.code}: ${error.message}`);
  } else {
    const code = typeof error?.code === 'string' && /^[A-Z0-9_]+$/.test(error.code)
      ? error.code
      : 'DATABASE_ERROR';
    console.error(`${code}: Database command failed. Verify configuration, database access, and preflight results. No credential details were logged.`);
  }
  process.exitCode = 1;
} finally {
  if (client) {
    try {
      await client.end({ timeout: 5 });
    } catch {
      console.error('DATABASE_CLOSE_FAILED: The database connection did not close cleanly.');
      process.exitCode = 1;
    }
  }
}
