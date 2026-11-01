import type { ProgressDTO } from './study';

export type ApiErrorCode =
  | 'VALIDATION_FAILED'
  | 'UNAUTHENTICATED'
  | 'ORIGIN_NOT_ALLOWED'
  | 'NOT_FOUND'
  | 'PROGRESS_CONFLICT'
  | 'BOOK_VERSION_CHANGED'
  | 'BOOK_DATA_INVALID'
  | 'EMPTY_BOOK'
  | 'RATE_LIMITED'
  | 'INTERNAL_ERROR'
  | 'SERVICE_UNAVAILABLE';

export interface ApiError {
  code: ApiErrorCode;
  message: string;
  retryable: boolean;
  latestProgress?: ProgressDTO;
}

export type ApiResult<T> =
  | { ok: true; data: T; requestId: string }
  | { ok: false; error: ApiError; requestId: string };
