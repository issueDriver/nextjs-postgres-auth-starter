import { authenticatedApi } from 'lib/api/server';
import { getStudySnapshot } from 'lib/services/vocabulary';
import { parseBookId } from 'lib/validation/requests';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function GET(request: Request, { params }: { params: { bookId: string } }) {
  return authenticatedApi(request, (userId) => getStudySnapshot(userId, parseBookId(params.bookId)));
}
