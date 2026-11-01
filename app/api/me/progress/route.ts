import { authenticatedApi } from 'lib/api/server';
import { getMyProgress } from 'lib/services/vocabulary';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function GET(request: Request) {
  return authenticatedApi(request, getMyProgress);
}
