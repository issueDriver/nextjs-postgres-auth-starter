import { authenticatedApi, readJson } from 'lib/api/server';
import { visitStudy } from 'lib/services/vocabulary';
import { parseBookId, parseStudyWrite } from 'lib/validation/requests';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function POST(request: Request, { params }: { params: { bookId: string } }) {
  return authenticatedApi(request, async (userId) => visitStudy(userId, parseBookId(params.bookId), parseStudyWrite(await readJson(request))), true);
}
