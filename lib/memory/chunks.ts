import { createHash } from "node:crypto";
import type { UserDb } from "@/lib/db/user-db";
import type { UserContext } from "@/lib/db/provision";
import type { Confidence, SourceType } from "@/lib/db/user-migrations";
import { toVectorLiteral, type Embedder } from "./embeddings";

export interface Provenance {
  sourceType: SourceType;
  sourceRef?: string | null;
  confidence: Confidence;
  externalUrl?: string | null;
  transcriptSpan?: Record<string, unknown> | null;
}

export type EntityType =
  | "profile"
  | "transcript"
  | "track"
  | "track_item"
  | "project"
  | "link_ref"
  | "reflection"
  | "achievement";

export function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

export function chunkText(text: string, maxChars = 900): string[] {
  const clean = text.replace(/\r\n/g, "\n").trim();
  if (!clean) return [];
  const paragraphs = clean.split(/\n{2,}/);
  const chunks: string[] = [];
  let current = "";
  for (const p of paragraphs) {
    if (p.length > maxChars) {
      if (current) chunks.push(current);
      current = "";
      for (let i = 0; i < p.length; i += maxChars) chunks.push(p.slice(i, i + maxChars));
      continue;
    }
    if ((current + "\n\n" + p).length > maxChars && current) {
      chunks.push(current);
      current = p;
    } else {
      current = current ? `${current}\n\n${p}` : p;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

/** Replaces all chunks for one entity in the caller's store. */
export async function indexEntity(
  db: UserDb,
  ctx: UserContext,
  embedder: Embedder,
  entity: { type: EntityType; id: string; text: string; provenance: Provenance },
): Promise<string[]> {
  await db.query("DELETE FROM memory_chunks WHERE user_id = $1 AND entity_type = $2 AND entity_id = $3", [
    ctx.userId,
    entity.type,
    entity.id,
  ]);
  const pieces = chunkText(entity.text);
  if (pieces.length === 0) return [];
  const vectors = await embedder.embed(pieces);
  const ids: string[] = [];
  for (let i = 0; i < pieces.length; i++) {
    const p = entity.provenance;
    const { rows } = await db.query<{ id: string }>(
      `INSERT INTO memory_chunks
         (user_id, entity_type, entity_id, chunk_index, content, embedding,
          source_type, source_ref, confidence, external_url, transcript_span, content_hash)
       VALUES ($1, $2, $3, $4, $5, $6::vector, $7, $8, $9, $10, $11, $12)
       RETURNING id`,
      [
        ctx.userId,
        entity.type,
        entity.id,
        i,
        pieces[i],
        toVectorLiteral(vectors[i]),
        p.sourceType,
        p.sourceRef ?? null,
        p.confidence,
        p.externalUrl ?? null,
        p.transcriptSpan ? JSON.stringify(p.transcriptSpan) : null,
        sha256(pieces[i]),
      ],
    );
    ids.push(rows[0].id);
  }
  return ids;
}

export async function tombstoneEntityChunks(
  db: UserDb,
  ctx: UserContext,
  entityType: EntityType,
  entityId: string,
): Promise<void> {
  await db.query(
    "UPDATE memory_chunks SET deleted_at = now() WHERE user_id = $1 AND entity_type = $2 AND entity_id = $3",
    [ctx.userId, entityType, entityId],
  );
}
