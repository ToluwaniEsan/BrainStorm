import { sql } from "drizzle-orm";
import {
  type AnyPgColumn, bigint, boolean, date, index, integer, pgTable, text, timestamp, uuid, vector,
} from "drizzle-orm/pg-core";

// Typed view of the tables app.provision_user() creates in every user's schema
// (db/migrations/0001_foundation.sql is the source of truth; keep them in sync).
// Tables are unqualified on purpose: withUser() points search_path at the
// signed-in user's schema, so these resolve to that user's tables only.
// Don't run `drizzle-kit push` against this file; schema changes go through
// a new SQL migration plus provision_user().

const id = () => uuid("id").primaryKey().defaultRandom();
// Filled by the database from the per-request app.sub setting.
const ownerSub = () => text("owner_sub").notNull().default(sql`current_setting('app.sub', true)`);
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp("updated_at", { withTimezone: true }).notNull().defaultNow();

export const profile = pgTable("profile", {
  id: id(), ownerSub: ownerSub(),
  displayName: text("display_name"), intro: text("intro"),
  portfolio: text("portfolio"), aboutWork: text("about_work"),
  createdAt: createdAt(), updatedAt: updatedAt(),
});

export const projects = pgTable("projects", {
  id: id(), ownerSub: ownerSub(),
  parentId: uuid("parent_id").references((): AnyPgColumn => projects.id, { onDelete: "set null" }),
  title: text("title").notNull(), description: text("description"),
  status: text("status").notNull().default("active"),
  createdAt: createdAt(), updatedAt: updatedAt(),
});

export const tasks = pgTable("tasks", {
  id: id(), ownerSub: ownerSub(),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  title: text("title").notNull(), notes: text("notes"),
  status: text("status").notNull().default("todo"),
  techStack: text("tech_stack").array().notNull().default([]),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: createdAt(), updatedAt: updatedAt(),
});

export const liveSessions = pgTable("live_sessions", {
  id: id(), ownerSub: ownerSub(),
  projectId: uuid("project_id").references(() => projects.id, { onDelete: "set null" }),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  endedAt: timestamp("ended_at", { withTimezone: true }),
});

export const transcripts = pgTable("transcripts", {
  id: id(), ownerSub: ownerSub(),
  sessionId: uuid("session_id").notNull().references(() => liveSessions.id, { onDelete: "cascade" }),
  body: text("body").notNull(),
  isFinal: boolean("is_final").notNull().default(false),
  spokenAt: timestamp("spoken_at", { withTimezone: true }).notNull().defaultNow(),
});

export const tracks = pgTable("tracks", {
  id: id(), ownerSub: ownerSub(),
  projectId: uuid("project_id").references(() => projects.id, { onDelete: "set null" }),
  title: text("title").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
  isActive: boolean("is_active").notNull().default(false),
  createdAt: createdAt(), updatedAt: updatedAt(),
});

export const trackItems = pgTable("track_items", {
  id: id(), ownerSub: ownerSub(),
  trackId: uuid("track_id").notNull().references(() => tracks.id, { onDelete: "cascade" }),
  sessionId: uuid("session_id").references(() => liveSessions.id, { onDelete: "set null" }),
  body: text("body").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
  confidence: text("confidence").notNull().default("live_draft"),
  createdAt: createdAt(), updatedAt: updatedAt(),
});

export const files = pgTable("files", {
  id: id(), ownerSub: ownerSub(),
  filename: text("filename").notNull(), mimeType: text("mime_type").notNull(),
  sizeBytes: bigint("size_bytes", { mode: "number" }),
  storagePath: text("storage_path").notNull(), compression: text("compression"),
  extractedText: text("extracted_text"), summary: text("summary"),
  createdAt: createdAt(),
});

export const links = pgTable("links", {
  id: id(), ownerSub: ownerSub(),
  url: text("url").notNull(), kind: text("kind").notNull().default("web"),
  title: text("title"), snapshot: text("snapshot"),
  fetchedAt: timestamp("fetched_at", { withTimezone: true }),
  createdAt: createdAt(),
});

export const reflections = pgTable("reflections", {
  id: id(), ownerSub: ownerSub(),
  question: text("question").notNull(), answer: text("answer"),
  themes: text("themes").array().notNull().default([]),
  createdAt: createdAt(),
});

export const achievements = pgTable("achievements", {
  id: id(), ownerSub: ownerSub(),
  title: text("title").notNull(), detail: text("detail"),
  achievedOn: date("achieved_on"),
  createdAt: createdAt(),
});

export const searchEvents = pgTable("search_events", {
  id: id(), ownerSub: ownerSub(),
  triggerText: text("trigger_text").notNull(), query: text("query").notNull(),
  resultUrls: text("result_urls").array().notNull().default([]),
  createdAt: createdAt(),
});

export const memoryChunks = pgTable("memory_chunks", {
  id: id(), ownerSub: ownerSub(),
  sourceType: text("source_type").notNull(), sourceTable: text("source_table").notNull(),
  sourceId: uuid("source_id").notNull(), body: text("body").notNull(),
  embedding: vector("embedding", { dimensions: 768 }),
  createdAt: createdAt(),
}, (t) => [index("memory_chunks_embedding_idx").using("hnsw", t.embedding.op("vector_cosine_ops"))]);
