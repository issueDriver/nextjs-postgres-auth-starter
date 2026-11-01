import { authenticatedApi } from 'lib/api/server';
import { getCatalog } from 'lib/services/vocabulary';
import { parseBookId, parsePagination } from 'lib/validation/requests';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function GET(request: Request, { params }: { params: { bookId: string } }) {
  return authenticatedApi(request, (userId) => getCatalog(userId, parseBookId(params.bookId), parsePagination(request.url)));
}
