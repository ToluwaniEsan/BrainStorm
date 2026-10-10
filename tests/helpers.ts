import { randomUUID } from "node:crypto";
import { expect } from "vitest";
import { resolveUserContext, type SessionLike } from "@/lib/auth/context";
import { migrateApp } from "@/lib/db/app-migrations";
import { closePool, getPool } from "@/lib/db/pool";
import { deleteUserStore, type UserContext } from "@/lib/db/provision";
import { withUserDb } from "@/lib/db/user-db";
import { indexEntity } from "@/lib/memory/chunks";
import { HashEmbedder } from "@/lib/memory/embeddings";
import { startRealtimeSession } from "@/lib/realtime/session";
import { recordUserTranscript } from "@/lib/realtime/session";

export const embedder = new HashEmbedder();
export const pool = () => getPool();

const createdSubs = new Set<string>();
const createdCtx = new Map<string, UserContext>();

export async function setupDb() {
  await migrateApp(getPool());
}

export function sessionFor(sub: string, createdAtSec = Math.floor(Date.now() / 1000)): SessionLike {
  return { user: { sub }, internal: { createdAt: createdAtSec } };
}

export function newSub(label: string) {
  const sub = `auth0|test-${label}-${randomUUID()}`;
  createdSubs.add(sub);
  return sub;
}

export async function newUser(label: string): Promise<UserContext> {
  const sub = newSub(label);
  const ctx = await resolveUserContext(getPool(), sessionFor(sub));
  createdCtx.set(sub, ctx);
  return ctx;
}

export async function teardownDb() {
  const p = getPool();
  for (const sub of createdSubs) {
    const { rows } = await p.query("SELECT id, auth0_sub, schema_name, role_name FROM app.users WHERE auth0_sub = $1", [sub]);
    if (rows[0]) {
      await deleteUserStore(p, {
        userId: rows[0].id,
        auth0Sub: rows[0].auth0_sub,
        schema: rows[0].schema_name,
        role: rows[0].role_name,
      });
    }
  }
  await p.query("DELETE FROM app.account_tombstones WHERE auth0_sub = ANY($1::text[])", [[...createdSubs]]);
  createdSubs.clear();
  createdCtx.clear();
  await closePool();
}

export async function countUsers(): Promise<number> {
  const { rows } = await getPool().query<{ n: string }>("SELECT count(*) AS n FROM app.users");
  return Number(rows[0].n);
}

export async function startSession(ctx: UserContext, captured?: { instructions?: string }) {
  return startRealtimeSession(getPool(), ctx, {
    apiKey: "test-key",
    mint: async (opts) => {
      if (captured) captured.instructions = opts.instructions;
      return { value: "ek_test", expiresAt: 0, model: "gpt-realtime" };
    },
  });
}

let itemSeq = 0;
export async function say(ctx: UserContext, sessionId: string, text: string) {
  return withUserDb(getPool(), ctx, (db) =>
    recordUserTranscript(db, ctx, embedder, { sessionId, itemId: `item-${++itemSeq}`, text, isFinal: true }),
  );
}

export async function remember(ctx: UserContext, text: string, sourceType: "chat" | "ui" = "chat") {
  return withUserDb(getPool(), ctx, (db) =>
    indexEntity(db, ctx, embedder, {
      type: "reflection",
      id: randomUUID(),
      text,
      provenance: { sourceType, confidence: "user_asserted" },
    }),
  );
}

export async function expectPgError(promise: Promise<unknown>, code: string) {
  await expect(promise).rejects.toMatchObject({ code });
}
