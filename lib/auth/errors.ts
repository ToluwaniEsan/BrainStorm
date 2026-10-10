export class AuthError extends Error {
  constructor(
    readonly status: 401 | 403,
    readonly code: string,
  ) {
    super(code);
    this.name = "AuthError";
  }
}

export class BadRequestError extends Error {
  constructor(
    readonly code: string,
    readonly detail?: unknown,
  ) {
    super(code);
    this.name = "BadRequestError";
  }
}

export class NotFoundError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "NotFoundError";
  }
}
