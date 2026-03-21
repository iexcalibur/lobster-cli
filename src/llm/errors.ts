export enum InvokeErrorType {
  NETWORK_ERROR = 'NETWORK_ERROR',
  AUTH_ERROR = 'AUTH_ERROR',
  RATE_LIMIT = 'RATE_LIMIT',
  SERVER_ERROR = 'SERVER_ERROR',
  CONTEXT_LENGTH = 'CONTEXT_LENGTH',
  CONTENT_FILTER = 'CONTENT_FILTER',
  NO_TOOL_CALL = 'NO_TOOL_CALL',
  INVALID_TOOL_ARGS = 'INVALID_TOOL_ARGS',
  TOOL_EXECUTION_ERROR = 'TOOL_EXECUTION_ERROR',
  UNKNOWN = 'UNKNOWN',
}

export class InvokeError extends Error {
  type: InvokeErrorType;
  retryable: boolean;
  rawError?: unknown;
  rawResponse?: unknown;

  constructor(type: InvokeErrorType, message: string, opts?: { retryable?: boolean; rawError?: unknown; rawResponse?: unknown }) {
    super(message);
    this.name = 'InvokeError';
    this.type = type;
    this.retryable = opts?.retryable ?? isRetryable(type);
    this.rawError = opts?.rawError;
    this.rawResponse = opts?.rawResponse;
  }
}

function isRetryable(type: InvokeErrorType): boolean {
  switch (type) {
    case InvokeErrorType.NETWORK_ERROR:
    case InvokeErrorType.RATE_LIMIT:
    case InvokeErrorType.SERVER_ERROR:
    case InvokeErrorType.NO_TOOL_CALL:
    case InvokeErrorType.INVALID_TOOL_ARGS:
    case InvokeErrorType.TOOL_EXECUTION_ERROR:
    case InvokeErrorType.UNKNOWN:
      return true;
    case InvokeErrorType.AUTH_ERROR:
    case InvokeErrorType.CONTEXT_LENGTH:
    case InvokeErrorType.CONTENT_FILTER:
      return false;
  }
}
