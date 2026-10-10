import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resolveUserContext } from "@/lib/auth/context";
import { AuthError } from "@/lib/auth/errors";
import { UnsafeIdentifierError } from "@/lib/db/identifiers";
import { deleteUserStore, type UserContext } from "@/lib/db/provision";
import { withUserDb } from "@/lib/db/user-db";
import { retrieveMemory } from "@/lib/memory/retrieval";
import { createTrack, listTracks } from "@/lib/tracks/store";
import {
  countUsers,
  embedder,
  expectPgError,
  newSub,
  newUser,
  pool,
  remember,
  sessionFor,
  setupDb,
  teardownDb,
} from "./helpers";

const prov = { sessionId: null, sourceType: "ui" as const, confidence: "user_asserted" as const, transcriptSpan: null };

beforeAll(setupDb);
afterAll(teardownDb);

describe("signed-out access is denied", () => {
  it.each([
    ["null session", null],
    ["undefined session", undefined],
    ["no user", { internal: { createdAt: 1 } }],
    ["non-string sub", { user: { sub: 42 }, internal: { createdAt: 1 } }],
    ["malformed sub", { user: { sub: "'; DROP SCHEMA app; --" }, internal: { createdAt: 1 } }],
    ["missing issued-at", { user: { sub: "auth0|abc" } }],
  ])("%s → 401 and nothing provisioned", async (_label, session) => {
    const before = await countUsers();
    await expect(resolveUserContext(pool(), session as never)).rejects.toMatchObject({ status: 401 });
    expect(await countUsers()).toBe(before);
  });
});

describe("per-user schema isolation", () => {
  let A: UserContext;
  let B: UserContext;

  beforeAll(async () => {
    A = await newUser("a");
    B = await newUser("b");
    await withUserDb(pool(), A, (db) => createTrack(db, A, "A's secret onboarding lane", prov));
    await remember(A, "A is building a generative audio visualizer with WebGL shaders");
  });

  it("provisions distinct schemas and roles, idempotently", async () => {
    expect(A.schema).not.toBe(B.schema);
    expect(A.role).not.toBe(B.role);
    const again = await resolveUserContext(pool(), sessionFor(A.auth0Sub));
    expect(again).toEqual(A);
  });

  it("first login creates an empty store (no ghost seed data)", async () => {
    const tracks = await withUserDb(pool(), B, (db) => listTracks(db, B));
    expect(tracks).toEqual([]);
    const { rows } = await withUserDb(pool(), B, (db) => db.query("SELECT count(*)::int AS n FROM memory_chunks"));
    expect(rows[0].n).toBe(0);
  });

  it("A's data is invisible to B through normal reads and retrieval", async () => {
    const bTracks = await withUserDb(pool(), B, (db) => listTracks(db, B));
    expect(bTracks).toEqual([]);
    const bHits = await withUserDb(pool(), B, (db) =>
      retrieveMemory(db, B, embedder, "generative audio visualizer WebGL shaders", { minScore: -1 }),
    );
    expect(bHits).toEqual([]);
    const aHits = await withUserDb(pool(), A, (db) =>
      retrieveMemory(db, A, embedder, "generative audio visualizer WebGL shaders"),
    );
    expect(aHits.length).toBeGreaterThan(0);
  });

  it("grants refuse A reading or writing B's schema", async () => {
    await expectPgError(
      withUserDb(pool(), A, (db) => db.query(`SELECT * FROM "${B.schema}".tracks`)),
      "42501",
    );
    await expectPgError(
      withUserDb(pool(), A, (db) =>
        db.query(
          `INSERT INTO "${B.schema}".tracks (user_id, title, source_type, confidence) VALUES ($1, 'x', 'ui', 'user_asserted')`,
          [B.userId],
        ),
      ),
      "42501",
    );
  });

  it("A's role cannot read the control plane or create objects", async () => {
    await expectPgError(withUserDb(pool(), A, (db) => db.query("SELECT * FROM app.users")), "42501");
    await expectPgError(withUserDb(pool(), A, (db) => db.query("CREATE TABLE public.leak (x int)")), "42501");
    await expectPgError(withUserDb(pool(), A, (db) => db.query(`CREATE TABLE "${A.schema}".extra (x int)`)), "42501");
  });

  it("a context pointing at the wrong schema is refused by grants", async () => {
    const tampered: UserContext = { ...A, schema: B.schema };
    // Without USAGE, Postgres drops B's schema from A's search_path, so the table is unresolvable.
    await expectPgError(withUserDb(pool(), tampered, (db) => db.query("SELECT * FROM tracks")), "42P01");
    await expectPgError(
      withUserDb(pool(), tampered, (db) => db.query(`SELECT * FROM "${B.schema}".tracks`)),
      "42501",
    );
  });

  it("session state never leaks across pooled connections", async () => {
    // Even a committed non-LOCAL SET (which Postgres permits for the pool's session user) is discarded on release.
    await withUserDb(pool(), A, (db) => db.query(`SET ROLE "${B.role}"`));
    const n = pool().totalCount;
    const clients = await Promise.all(Array.from({ length: n }, () => pool().connect()));
    try {
      for (const c of clients) {
        const { rows } = await c.query<{ r: string; uid: string | null }>(
          "SELECT current_user AS r, NULLIF(current_setting('app.user_id', true), '') AS uid",
        );
        expect([A.role, B.role]).not.toContain(rows[0].r);
        expect(rows[0].uid).toBeNull();
      }
    } finally {
      clients.forEach((c) => c.release());
    }
  });

  it("unsafe identifiers are refused before reaching SQL", async () => {
    const bad = { ...A, schema: "public" };
    await expect(withUserDb(pool(), bad, async () => 1)).rejects.toBeInstanceOf(UnsafeIdentifierError);
    const bad2 = { ...A, role: "postgres" };
    await expect(withUserDb(pool(), bad2, async () => 1)).rejects.toBeInstanceOf(UnsafeIdentifierError);
  });

  it("RLS is a second check: wrong user_id cannot be written or read", async () => {
    await expectPgError(
      withUserDb(pool(), A, (db) =>
        db.query(
          "INSERT INTO tracks (user_id, title, source_type, confidence) VALUES ($1, 'spoof', 'ui', 'user_asserted')",
          [B.userId],
        ),
      ),
      "42501",
    );
    const wrongId: UserContext = { ...A, userId: B.userId };
    const rows = await withUserDb(pool(), wrongId, (db) => db.query("SELECT * FROM tracks"));
    expect(rows.rowCount).toBe(0);
  });

  it("RLS fails closed when app.user_id is unset", async () => {
    const client = await pool().connect();
    try {
      await client.query("BEGIN");
      await client.query(`SET LOCAL ROLE "${A.role}"`);
      const r = await client.query(`SELECT * FROM "${A.schema}".tracks`);
      expect(r.rowCount).toBe(0);
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  });
});

describe("account delete wipes the store", () => {
  it("drops schema + role + mapping, revokes old sessions, and re-login starts empty", async () => {
    const sub = newSub("del");
    const oldSession = sessionFor(sub, Math.floor(Date.now() / 1000) - 5);
    const ctx = await resolveUserContext(pool(), oldSession);
    await withUserDb(pool(), ctx, (db) => createTrack(db, ctx, "to be wiped", prov));
    await remember(ctx, "wiped memory about ceramics glaze experiments");

    await deleteUserStore(pool(), ctx);

    const ns = await pool().query("SELECT 1 FROM pg_namespace WHERE nspname = $1", [ctx.schema]);
    const role = await pool().query("SELECT 1 FROM pg_roles WHERE rolname = $1", [ctx.role]);
    const map = await pool().query("SELECT 1 FROM app.users WHERE auth0_sub = $1", [sub]);
    expect(ns.rowCount).toBe(0);
    expect(role.rowCount).toBe(0);
    expect(map.rowCount).toBe(0);

    const denied = resolveUserContext(pool(), oldSession);
    await expect(denied).rejects.toBeInstanceOf(AuthError);
    await expect(denied).rejects.toMatchObject({ status: 401, code: "session_revoked" });

    const fresh = await resolveUserContext(pool(), sessionFor(sub, Math.floor(Date.now() / 1000) + 5));
    expect(fresh.schema).not.toBe(ctx.schema);
    const hits = await withUserDb(pool(), fresh, (db) =>
      retrieveMemory(db, fresh, embedder, "ceramics glaze experiments", { minScore: -1 }),
    );
    expect(hits).toEqual([]);
    expect(await withUserDb(pool(), fresh, (db) => listTracks(db, fresh))).toEqual([]);
  });
});
