export class ApplicationError extends Error {
  constructor(message: string, readonly code: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class ValidationError extends ApplicationError {
  constructor(message: string) {
    super(message, "VALIDATION_ERROR");
  }
}

export class NotFoundError extends ApplicationError {
  constructor(message: string) {
    super(message, "NOT_FOUND");
  }
}

export class ForbiddenError extends ApplicationError {
  constructor(message: string) {
    super(message, "FORBIDDEN");
  }
}

export class ConflictError extends ApplicationError {
  constructor(message: string) {
    super(message, "CONFLICT");
  }
}

export class InvalidStateTransitionError extends ApplicationError {
  constructor(message: string) {
    super(message, "INVALID_STATE_TRANSITION");
  }
}
