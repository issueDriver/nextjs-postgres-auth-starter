import 'server-only';
import { randomUUID } from 'node:crypto';
import { auth } from 'app/auth';
import { ServiceError } from 'lib/services/errors';
import { assertTrustedOrigin } from 'lib/validation/requests';

const headers = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' };

export async function apiResponse<T>(work: () => Promise<T>): Promise<Response> {
  const requestId = randomUUID();
  try {
    return Response.json({ ok: true, data: await work(), requestId }, { headers });
  } catch (error) {
    if (error instanceof ServiceError) {
      return Response.json({ ok: false, error: { code: error.code, message: error.message, retryable: error.retryable, ...(error.latestProgress ? { latestProgress: error.latestProgress } : {}) }, requestId }, { status: error.status, headers });
    }
    console.error('api_request_failed', { requestId, code: 'INTERNAL_ERROR' });
    return Response.json({ ok: false, error: { code: 'INTERNAL_ERROR', message: '服务暂时不可用，请重试', retryable: true }, requestId }, { status: 500, headers });
  }
}

export function authenticatedApi<T>(request: Request, work: (userId: number) => Promise<T>, write = false) {
  return apiResponse(async () => {
    if (write) assertTrustedOrigin(request);
    const session = await auth();
    const id = session?.user?.id;
    if (!id || !/^\d+$/.test(id) || !Number.isSafeInteger(Number(id)) || Number(id) < 1 || Number(id) > 2147483647) throw new ServiceError('UNAUTHENTICATED');
    return work(Number(id));
  });
}

export async function readJson(request: Request): Promise<unknown> {
  if (request.headers.get('content-type')?.split(';')[0].trim() !== 'application/json' || !request.body) throw new ServiceError('VALIDATION_FAILED');
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 2048) { await reader.cancel(); throw new ServiceError('VALIDATION_FAILED'); }
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new ServiceError('VALIDATION_FAILED');
  } finally {
    reader.releaseLock();
  }
}
