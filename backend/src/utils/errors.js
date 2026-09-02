export class AppError extends Error {
  constructor(status, code, message, details = undefined) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function publicError(error, requestId = null) {
  if (error instanceof AppError) {
    const status = Number(error.status) || 500;
    const body = {
      error: error.code || (status >= 500 ? 'INTERNAL_ERROR' : 'REQUEST_FAILED'),
      message: status >= 500 ? 'Interner Serverfehler. Details stehen im Backend-Protokoll.' : error.message,
      requestId: requestId || undefined,
    };
    if (status < 500 && error.details !== undefined) body.details = error.details;
    return { status, body };
  }
  return {
    status: 500,
    body: { error: 'INTERNAL_ERROR', message: 'Interner Serverfehler. Details stehen im Backend-Protokoll.', requestId: requestId || undefined },
  };
}
