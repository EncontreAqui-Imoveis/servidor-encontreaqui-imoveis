export type ApplicationErrorCode =
  | 'INVALID_INPUT'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'PAYLOAD_TOO_LARGE'
  | 'GONE'
  | 'LOCKED'
  | 'TOO_MANY_REQUESTS'
  | 'UNAVAILABLE'
  | 'GATEWAY_TIMEOUT'
  | 'INTERNAL';

export class ApplicationError extends Error {
  readonly code: ApplicationErrorCode;
  readonly details?: Record<string, unknown>;

  constructor(code: ApplicationErrorCode, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = 'ApplicationError';
    this.code = code;
    this.details = details;
  }
}

export class InvalidInputError extends ApplicationError {
  constructor(message: string, details?: Record<string, unknown>) {
    super('INVALID_INPUT', message, details);
  }
}

export class UnauthorizedError extends ApplicationError {
  constructor(message: string, details?: Record<string, unknown>) {
    super('UNAUTHORIZED', message, details);
  }
}

export class ForbiddenError extends ApplicationError {
  constructor(message: string, details?: Record<string, unknown>) {
    super('FORBIDDEN', message, details);
  }
}

export class NotFoundError extends ApplicationError {
  constructor(message: string, details?: Record<string, unknown>) {
    super('NOT_FOUND', message, details);
  }
}

export class ConflictError extends ApplicationError {
  constructor(message: string, details?: Record<string, unknown>) {
    super('CONFLICT', message, details);
  }
}

export class PayloadTooLargeError extends ApplicationError {
  constructor(message: string, details?: Record<string, unknown>) {
    super('PAYLOAD_TOO_LARGE', message, details);
  }
}

export class GoneError extends ApplicationError {
  constructor(message: string, details?: Record<string, unknown>) {
    super('GONE', message, details);
  }
}

export class LockedError extends ApplicationError {
  constructor(message: string, details?: Record<string, unknown>) {
    super('LOCKED', message, details);
  }
}

export class TooManyRequestsError extends ApplicationError {
  constructor(message: string, details?: Record<string, unknown>) {
    super('TOO_MANY_REQUESTS', message, details);
  }
}

export class UnavailableError extends ApplicationError {
  constructor(message: string, details?: Record<string, unknown>) {
    super('UNAVAILABLE', message, details);
  }
}

export class GatewayTimeoutError extends ApplicationError {
  constructor(message: string, details?: Record<string, unknown>) {
    super('GATEWAY_TIMEOUT', message, details);
  }
}

export class InternalError extends ApplicationError {
  constructor(message: string, details?: Record<string, unknown>) {
    super('INTERNAL', message, details);
  }
}

export function isApplicationError(error: unknown): error is ApplicationError {
  return error instanceof ApplicationError;
}

export function applicationErrorToHttpStatus(error: ApplicationError): number {
  switch (error.code) {
    case 'INVALID_INPUT':
      return 400;
    case 'UNAUTHORIZED':
      return 401;
    case 'FORBIDDEN':
      return 403;
    case 'NOT_FOUND':
      return 404;
    case 'CONFLICT':
      return 409;
    case 'PAYLOAD_TOO_LARGE':
      return 413;
    case 'GONE':
      return 410;
    case 'LOCKED':
      return 423;
    case 'TOO_MANY_REQUESTS':
      return 429;
    case 'UNAVAILABLE':
      return 503;
    case 'GATEWAY_TIMEOUT':
      return 504;
    case 'INTERNAL':
    default:
      return 500;
  }
}
