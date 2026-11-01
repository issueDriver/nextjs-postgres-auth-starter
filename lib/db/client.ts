import 'server-only';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { databaseConfig } from './config.mjs';
import * as schema from './schema';

const databaseGlobal = globalThis as typeof globalThis & {
  vocabularySql?: ReturnType<typeof postgres>;
};

function createClient() {
  const { connectionString, options } = databaseConfig();
  return postgres(connectionString, options);
}

export const sqlClient = databaseGlobal.vocabularySql ?? createClient();

if (process.env.NODE_ENV !== 'production') {
  databaseGlobal.vocabularySql = sqlClient;
}

export const db = drizzle(sqlClient, { schema });
