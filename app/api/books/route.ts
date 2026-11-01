import { apiResponse } from 'lib/api/server';
import { listBooks } from 'lib/services/vocabulary';
import { parsePagination } from 'lib/validation/requests';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function GET(request: Request) {
  return apiResponse(() => listBooks(parsePagination(request.url)));
}
