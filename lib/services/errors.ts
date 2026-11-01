import type { ApiErrorCode } from 'lib/contracts/errors';
import type { ProgressDTO } from 'lib/contracts/study';

const ERRORS: Record<ApiErrorCode, { message: string; status: number; retryable: boolean }> = {
  VALIDATION_FAILED: { message: '请求参数不正确', status: 400, retryable: false },
  UNAUTHENTICATED: { message: '请先登录', status: 401, retryable: false },
  ORIGIN_NOT_ALLOWED: { message: '请求来源不受信任', status: 403, retryable: false },
  NOT_FOUND: { message: '内容暂不可用', status: 404, retryable: false },
  PROGRESS_CONFLICT: { message: '学习进度已更新', status: 409, retryable: false },
  BOOK_VERSION_CHANGED: { message: '词书已更新，暂时无法继续学习', status: 409, retryable: false },
  BOOK_DATA_INVALID: { message: '词库暂不可用', status: 409, retryable: false },
  EMPTY_BOOK: { message: '本书暂无单词', status: 422, retryable: false },
  RATE_LIMITED: { message: '操作过于频繁，请稍后再试', status: 429, retryable: true },
  INTERNAL_ERROR: { message: '服务暂时不可用，请重试', status: 500, retryable: true },
  SERVICE_UNAVAILABLE: { message: '服务暂时不可用，请重试', status: 503, retryable: true },
};

export class ServiceError extends Error {
  readonly status: number;
  readonly retryable: boolean;
  readonly latestProgress?: ProgressDTO;

  constructor(readonly code: ApiErrorCode, options: { latestProgress?: ProgressDTO } = {}) {
    super(ERRORS[code].message);
    this.name = 'ServiceError';
    this.status = ERRORS[code].status;
    this.retryable = ERRORS[code].retryable;
    this.latestProgress = options.latestProgress;
  }
}
