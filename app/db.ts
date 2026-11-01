import 'server-only';
import { sql } from 'drizzle-orm';
import { hash } from 'bcrypt-ts';
import { db } from 'lib/db/client';
import { users } from 'lib/db/schema';
import { normalizeEmail, validateAuthInput } from 'lib/validation/auth';

export async function getUser(email: string) {
  return db.select().from(users).where(
    sql`lower(btrim(${users.email})) = ${normalizeEmail(email)}`,
  ).limit(1);
}

export async function createUser(email: string, password: string) {
  const input = validateAuthInput(email, password, 'register');
  if (!input.ok) throw new Error('INVALID_AUTH_INPUT');
  const passwordHash = await hash(input.data.password, 10);

  return db.insert(users)
    .values({ email: input.data.email, password: passwordHash })
    .returning({ id: users.id, email: users.email });
}
