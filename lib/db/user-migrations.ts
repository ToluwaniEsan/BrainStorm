import type { PoolClient } from "pg";
import { assertUserRole, assertUserSchema, ident } from "./identifiers";

export const EMBEDDING_DIMENSIONS = 1536;

export const SOURCE_TYPES = [
  "chat",
  "audio",
  "realtime",
  "file",
  "ui",
  "link",
  "github",
  "web_assisted",
] as const;
export type SourceType = (typeof SOURCE_TYPES)[number];

export const CONFIDENCE_LEVELS = [
  "user_asserted",
  "model_extracted_pending_confirm",
  "external_fetched",
  "external_assisted",
  "live_draft",
] as const;
export type Confidence = (typeof CONFIDENCE_LEVELS)[number];

const sqlList = (values: readonly string[]) => values.map((v) => `'${v}'`).join(", ");

const PROVENANCE_COLUMNS = `
  source_type     text NOT NULL CHECK (source_type IN (${sqlList(SOURCE_TYPES)})),
  source_ref      text,
  confidence      text NOT NULL CHECK (confidence IN (${sqlList(CONFIDENCE_LEVELS)})),
  external_url    text,
  transcript_span jsonb,
  content_hash    text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
`;

const RLS_TABLES = [
  "profile",
  "realtime_sessions",
  "transcripts",
  "projects",
  "tracks",
  "track_items",
  "track_events",
  "link_refs",
  "assisted_search_events",
  "memory_chunks",
];

/**
 * Per-user schema migrations, applied inside each `user_<id>` schema.
 * Every table carries `user_id` and an RLS policy as a second check on top of
 * schema grants. Append new versions; never edit shipped ones.
 */
const USER_MIGRATIONS: Array<(s: string) => string> = [
  (s) => `
  CREATE TABLE ${s}.profile (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    uuid NOT NULL,
    intro      text,
    portfolio  text,
    ${PROVENANCE_COLUMNS}
  );

  CREATE TABLE ${s}.realtime_sessions (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    uuid NOT NULL,
    mode       text NOT NULL CHECK (mode IN ('realtime', 'degraded_batch')),
    model      text,
    status     text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'ended')),
    started_at timestamptz NOT NULL DEFAULT now(),
    ended_at   timestamptz
  );

  CREATE TABLE ${s}.transcripts (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    uuid NOT NULL,
    session_id uuid NOT NULL REFERENCES ${s}.realtime_sessions(id) ON DELETE CASCADE,
    item_id    text,
    speaker    text NOT NULL CHECK (speaker IN ('user', 'assistant')),
    text       text NOT NULL,
    is_final   boolean NOT NULL DEFAULT false,
    start_ms   integer,
    end_ms     integer,
    deleted_at timestamptz,
    ${PROVENANCE_COLUMNS}
  );
  CREATE UNIQUE INDEX transcripts_item_uq ON ${s}.transcripts (session_id, item_id) WHERE item_id IS NOT NULL;

  CREATE TABLE ${s}.projects (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     uuid NOT NULL,
    title       text NOT NULL,
    description text,
    status      text,
    deleted_at  timestamptz,
    ${PROVENANCE_COLUMNS}
  );

  CREATE TABLE ${s}.tracks (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      uuid NOT NULL,
    title        text NOT NULL,
    sort_order   integer NOT NULL DEFAULT 0,
    is_active    boolean NOT NULL DEFAULT false,
    project_id   uuid REFERENCES ${s}.projects(id) ON DELETE SET NULL,
    feature_keys text[] NOT NULL DEFAULT '{}',
    session_ids  uuid[] NOT NULL DEFAULT '{}',
    merged_into  uuid REFERENCES ${s}.tracks(id) ON DELETE SET NULL,
    deleted_at   timestamptz,
    ${PROVENANCE_COLUMNS}
  );
  CREATE UNIQUE INDEX tracks_one_active ON ${s}.tracks (user_id) WHERE is_active AND deleted_at IS NULL;

  CREATE TABLE ${s}.track_items (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    uuid NOT NULL,
    track_id   uuid NOT NULL REFERENCES ${s}.tracks(id) ON DELETE CASCADE,
    body       text NOT NULL,
    sort_order integer NOT NULL DEFAULT 0,
    deleted_at timestamptz,
    ${PROVENANCE_COLUMNS}
  );

  CREATE TABLE ${s}.track_events (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         uuid NOT NULL,
    session_id      uuid REFERENCES ${s}.realtime_sessions(id) ON DELETE SET NULL,
    event_type      text NOT NULL CHECK (event_type IN
                      ('track.create', 'track.append', 'track.switch', 'track_item.move', 'track_item.edit', 'track.merge')),
    track_id        uuid,
    item_id         uuid,
    payload         jsonb NOT NULL DEFAULT '{}',
    user_quote      text,
    tool_call_id    text,
    ${PROVENANCE_COLUMNS}
  );

  CREATE TABLE ${s}.link_refs (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id        uuid NOT NULL,
    url            text NOT NULL,
    kind           text NOT NULL CHECK (kind IN ('github_repo', 'generic_url')),
    canonical_repo text,
    title          text,
    summary        text,
    status         text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'ready', 'failed')),
    error          text,
    snapshot       jsonb,
    commit_sha     text,
    paths_indexed  text[] NOT NULL DEFAULT '{}',
    snapshot_at    timestamptz,
    deleted_at     timestamptz,
    ${PROVENANCE_COLUMNS}
  );

  CREATE TABLE ${s}.assisted_search_events (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id           uuid NOT NULL,
    session_id        uuid REFERENCES ${s}.realtime_sessions(id) ON DELETE SET NULL,
    trigger_utterance text NOT NULL,
    signal_kind       text NOT NULL CHECK (signal_kind IN ('stuck', 'explicit_help')),
    query             text NOT NULL,
    memory_ids        uuid[] NOT NULL,
    result_urls       text[] NOT NULL DEFAULT '{}',
    results           jsonb NOT NULL DEFAULT '[]',
    provider          text NOT NULL,
    created_at        timestamptz NOT NULL DEFAULT now()
  );

  CREATE TABLE ${s}.memory_chunks (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     uuid NOT NULL,
    entity_type text NOT NULL,
    entity_id   uuid NOT NULL,
    chunk_index integer NOT NULL DEFAULT 0,
    content     text NOT NULL,
    embedding   public.vector(${EMBEDDING_DIMENSIONS}) NOT NULL,
    deleted_at  timestamptz,
    ${PROVENANCE_COLUMNS}
  );
  CREATE INDEX memory_chunks_entity ON ${s}.memory_chunks (entity_type, entity_id);
  CREATE INDEX memory_chunks_embedding ON ${s}.memory_chunks USING hnsw (embedding public.vector_cosine_ops);
  `,
];

export const LATEST_USER_SCHEMA_VERSION = USER_MIGRATIONS.length;

function rlsStatements(s: string): string {
  return RLS_TABLES.map(
    (t) => `
    ALTER TABLE ${s}.${t} ENABLE ROW LEVEL SECURITY;
    ALTER TABLE ${s}.${t} FORCE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS owner_only ON ${s}.${t};
    CREATE POLICY owner_only ON ${s}.${t}
      USING (user_id = NULLIF(current_setting('app.user_id', true), '')::uuid)
      WITH CHECK (user_id = NULLIF(current_setting('app.user_id', true), '')::uuid);`,
  ).join("\n");
}

/**
 * Brings one user schema up to the latest version. Caller owns the transaction.
 * The schema stays owned by the admin role; the user role only gets DML.
 */
export async function migrateUserSchema(
  client: PoolClient,
  schemaName: string,
  roleName: string,
  fromVersion: number,
): Promise<number> {
  const s = ident(assertUserSchema(schemaName));
  const r = ident(assertUserRole(roleName));
  if (fromVersion >= LATEST_USER_SCHEMA_VERSION) return fromVersion;
  for (let v = fromVersion + 1; v <= LATEST_USER_SCHEMA_VERSION; v++) {
    await client.query(USER_MIGRATIONS[v - 1](s));
  }
  await client.query(rlsStatements(s));
  await client.query(`
    REVOKE ALL ON ALL TABLES IN SCHEMA ${s} FROM PUBLIC;
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA ${s} TO ${r};
  `);
  return LATEST_USER_SCHEMA_VERSION;
}
