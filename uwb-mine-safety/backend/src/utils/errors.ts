/** 业务异常：携带 HTTP 状态码与可展示给客户端的消息 */
export class AppError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.details = details;
  }

  static badRequest(message: string, details?: unknown) {
    return new AppError(400, 'bad_request', message, details);
  }
  static unauthorized(message = '未登录或凭证无效') {
    return new AppError(401, 'unauthorized', message);
  }
  static forbidden(message = '无权执行该操作') {
    return new AppError(403, 'forbidden', message);
  }
  static notFound(message = '资源不存在') {
    return new AppError(404, 'not_found', message);
  }
  static conflict(message: string, details?: unknown) {
    return new AppError(409, 'conflict', message, details);
  }
  static unprocessable(message: string, details?: unknown) {
    return new AppError(422, 'unprocessable', message, details);
  }
}

export function isAppError(e: unknown): e is AppError {
  return e instanceof AppError;
}
