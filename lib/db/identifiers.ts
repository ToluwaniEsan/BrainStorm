const USER_SCHEMA_RE = /^user_[0-9a-f]{32}$/;
const USER_ROLE_RE = /^user_[0-9a-f]{32}_rw$/;

export class UnsafeIdentifierError extends Error {
  constructor(kind: string) {
    super(`refusing unsafe ${kind} identifier`);
    this.name = "UnsafeIdentifierError";
  }
}

export function namesForUserId(userId: string): { schema: string; role: string } {
  const hex = userId.replace(/-/g, "").toLowerCase();
  const schema = `user_${hex}`;
  const role = `${schema}_rw`;
  assertUserSchema(schema);
  assertUserRole(role);
  return { schema, role };
}

export function assertUserSchema(name: string): string {
  if (!USER_SCHEMA_RE.test(name)) throw new UnsafeIdentifierError("schema");
  return name;
}

export function assertUserRole(name: string): string {
  if (!USER_ROLE_RE.test(name)) throw new UnsafeIdentifierError("role");
  return name;
}

/** Only ever called on names that already passed the strict regexes above. */
export function ident(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}
