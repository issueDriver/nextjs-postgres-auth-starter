import assert from 'node:assert/strict';
import test from 'node:test';
import { databaseConfig } from '../lib/db/config.mjs';

test('existing PostgreSQL query parameters are preserved exactly', () => {
  const url = 'postgres://user@db.example.test/app?sslmode=verify-full&application_name=vocabulary';
  const config = databaseConfig({ POSTGRES_URL: url });
  assert.equal(config.connectionString, url);
  assert.equal(config.options.ssl, undefined);
  assert.equal(config.options.max, 5);
});

test('remote connections require TLS by default without rewriting the URL', () => {
  const url = 'postgresql://user@db.example.test/app';
  const config = databaseConfig({ POSTGRES_URL: url });
  assert.equal(config.connectionString, url);
  assert.equal(config.options.ssl, 'require');
});

test('loopback development databases do not require TLS by default', () => {
  for (const hostname of ['localhost', '127.0.0.1', '[::1]']) {
    const config = databaseConfig({ POSTGRES_URL: `postgres://user@${hostname}/app` });
    assert.equal(config.options.ssl, false);
  }
});

test('explicit sslmode is respected for both local and remote databases', () => {
  for (const url of [
    'postgres://user@localhost/app?sslmode=require',
    'postgres://user@db.example.test/app?sslmode=disable',
  ]) {
    const config = databaseConfig({ POSTGRES_URL: url });
    assert.equal(config.connectionString, url);
    assert.equal(config.options.ssl, undefined);
  }
});

test('migration credentials are never selected for application requests', () => {
  const env = {
    POSTGRES_URL: 'postgres://application@localhost/app',
    MIGRATION_DATABASE_URL: 'postgres://migration@localhost/app',
  };
  assert.equal(databaseConfig(env).connectionString, env.POSTGRES_URL);
  const migration = databaseConfig(env, { migration: true });
  assert.equal(migration.connectionString, env.MIGRATION_DATABASE_URL);
  assert.equal(migration.source, 'MIGRATION_DATABASE_URL');
  assert.equal(migration.options.max, 1);
  assert.equal(migration.options.prepare, false);
});

test('migrations fall back to the existing application URL', () => {
  const config = databaseConfig({ POSTGRES_URL: 'postgres://user@localhost/app' }, { migration: true });
  assert.equal(config.source, 'POSTGRES_URL');
});

test('invalid configuration errors do not echo connection values', () => {
  assert.throws(() => databaseConfig({}), { message: 'POSTGRES_URL is required.' });
  for (const value of ['invalid-private-value', 'https://db.example.test/app']) {
    assert.throws(() => databaseConfig({ POSTGRES_URL: value }), error => {
      assert.equal(error.message, 'POSTGRES_URL must be a valid PostgreSQL URL.');
      assert.equal(error.message.includes(value), false);
      return true;
    });
  }
});
