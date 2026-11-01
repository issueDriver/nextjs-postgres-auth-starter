/**
 * @param {NodeJS.ProcessEnv} [env]
 * @param {{ migration?: boolean }} [options]
 */
export function databaseConfig(env = process.env, { migration = false } = {}) {
  const source = migration && env.MIGRATION_DATABASE_URL
    ? 'MIGRATION_DATABASE_URL'
    : 'POSTGRES_URL';
  const connectionString = env[source];

  if (!connectionString) {
    throw new Error(`${source} is required.`);
  }

  let parsed;
  try {
    parsed = new URL(connectionString);
  } catch {
    throw new Error(`${source} must be a valid PostgreSQL URL.`);
  }

  if (!['postgres:', 'postgresql:'].includes(parsed.protocol) || !parsed.hostname) {
    throw new Error(`${source} must be a valid PostgreSQL URL.`);
  }

  /** @type {import('postgres').Options<{}>} */
  const options = {
    max: migration ? 1 : 5,
    prepare: false,
    connect_timeout: 15,
    idle_timeout: 20,
    onnotice: () => {},
  };

  if (!parsed.searchParams.has('sslmode')) {
    const localHosts = ['localhost', '127.0.0.1', '[::1]'];
    options.ssl = localHosts.includes(parsed.hostname) ? false : 'require';
  }

  return { connectionString, source, options };
}
