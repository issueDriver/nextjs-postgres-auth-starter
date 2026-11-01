import 'server-only';
import { sql } from 'drizzle-orm';
import { genSaltSync, hashSync } from 'bcrypt-ts';
import { db } from 'lib/db/client';
import { users } from 'lib/db/schema';

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

export async function getUser(email: string) {
  return db.select().from(users).where(
    sql`lower(btrim(${users.email})) = ${normalizeEmail(email)}`,
  );
}

export async function createUser(email: string, password: string) {
  let salt = genSaltSync(10);
  let hash = hashSync(password, salt);

  return db.insert(users).values({ email: normalizeEmail(email), password: hash });
}
