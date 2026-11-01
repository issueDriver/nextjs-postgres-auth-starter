import { authenticatedApi } from 'lib/api/server';
import { getBooksProgress } from 'lib/services/vocabulary';
import { ServiceError } from 'lib/services/errors';
import { parseBookId } from 'lib/validation/requests';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function GET(request: Request) {
  return authenticatedApi(request, (userId) => {
    const bookIds = Array.from(new Set(new URL(request.url).searchParams.getAll('bookId')));
    if (bookIds.length === 0 || bookIds.length > 20) throw new ServiceError('VALIDATION_FAILED');
    return getBooksProgress(userId, bookIds.map(parseBookId));
  });
}
