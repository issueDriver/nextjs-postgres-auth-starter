import type { StudyWriteRequest } from 'lib/contracts/study';
import { ServiceError } from 'lib/services/errors';

export function parseBookId(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(value)) throw new ServiceError('VALIDATION_FAILED');
  return value;
}

export function parseWordId(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{1,19}$/.test(value) || BigInt(value) <= BigInt(0) || BigInt(value) > BigInt('9223372036854775807')) {
    throw new ServiceError('VALIDATION_FAILED');
  }
  return value;
}

export function parsePagination(url: string): { limit?: number; cursor?: string } {
  const search = new URL(url).searchParams;
  const rawLimit = search.get('limit');
  const cursor = search.get('cursor');
  if (rawLimit !== null && (!/^\d{1,3}$/.test(rawLimit) || Number(rawLimit) < 1 || Number(rawLimit) > 100)) throw new ServiceError('VALIDATION_FAILED');
  if (cursor !== null && (cursor.length === 0 || cursor.length > 1024)) throw new ServiceError('VALIDATION_FAILED');
  return { ...(rawLimit === null ? {} : { limit: Number(rawLimit) }), ...(cursor === null ? {} : { cursor }) };
}

export function parseStudyWrite(value: unknown): StudyWriteRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ServiceError('VALIDATION_FAILED');
  const record = value as Record<string, unknown>;
  if (Object.keys(record).some((key) => !['wordId', 'bookVersion', 'expectedRevision'].includes(key))) throw new ServiceError('VALIDATION_FAILED');
  const wordId = parseWordId(record.wordId);
  if (!Number.isInteger(record.bookVersion) || (record.bookVersion as number) < 1 || (record.bookVersion as number) > 2147483647) throw new ServiceError('VALIDATION_FAILED');
  if (!Number.isInteger(record.expectedRevision) || (record.expectedRevision as number) < 0 || (record.expectedRevision as number) > 2147483647) throw new ServiceError('VALIDATION_FAILED');
  return { wordId, bookVersion: record.bookVersion as number, expectedRevision: record.expectedRevision as number };
}

export function trustedOrigins(env: NodeJS.ProcessEnv = process.env): Set<string> {
  const origins = new Set<string>();
  for (const value of [env.APP_ORIGIN, env.AUTH_URL, env.NEXTAUTH_URL, env.VERCEL_URL ? `https://${env.VERCEL_URL}` : undefined]) {
    if (!value) continue;
    try {
      const url = new URL(value);
      if (url.protocol === 'https:' || url.protocol === 'http:') origins.add(url.origin);
    } catch { /* Ignore invalid deployment configuration; never trust the request Host. */ }
  }
  if (env.NODE_ENV !== 'production') {
    for (const origin of ['http://localhost:3000', 'http://127.0.0.1:3000', 'http://localhost:3001', 'http://127.0.0.1:3001']) origins.add(origin);
  }
  return origins;
}

export function assertTrustedOrigin(request: Request) {
  const origin = request.headers.get('origin');
  if (!origin || !trustedOrigins().has(origin)) throw new ServiceError('ORIGIN_NOT_ALLOWED');
}
