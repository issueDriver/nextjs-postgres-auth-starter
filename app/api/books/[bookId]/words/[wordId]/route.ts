import { authenticatedApi } from 'lib/api/server';
import { getWordDetail } from 'lib/services/vocabulary';
import { parseBookId, parseWordId } from 'lib/validation/requests';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function GET(request: Request, { params }: { params: { bookId: string; wordId: string } }) {
  return authenticatedApi(request, (userId) => getWordDetail(userId, parseBookId(params.bookId), parseWordId(params.wordId)));
}
