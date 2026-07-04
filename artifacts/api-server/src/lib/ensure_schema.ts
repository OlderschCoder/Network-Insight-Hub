import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { logger } from "./logger";

// Idempotently reconcile known schema drift on self-hosted databases.
//
// Self-hosted deployments provision the database schema manually, so changes
// made to the code schema after the initial setup can be missing in production.
// Each step below is safe to run on every boot: it no-ops when the database is
// already correct, and self-heals a fresh or drifted database. Failures are
// logged, not fatal, so a reconcile problem never prevents the server starting.
export async function ensureSchema(): Promise<void> {
  // 1) Persistent bearer-token session store. When `sessions` is missing, both
  //    Entra SSO and break-glass login fail at the session-insert step with
  //    `relation "sessions" does not exist`, locking everyone out even though
  //    authentication itself succeeded. Mirrors lib/db/src/schema/sessions.ts.
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS "sessions" (
        "token" text PRIMARY KEY NOT NULL,
        "user_id" integer NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
        "created_at" timestamp DEFAULT now() NOT NULL,
        "expires_at" timestamp NOT NULL
      )
    `);
    await db.execute(
      sql`CREATE INDEX IF NOT EXISTS "sessions_user_id_idx" ON "sessions" ("user_id")`,
    );
    await db.execute(
      sql`CREATE INDEX IF NOT EXISTS "sessions_expires_at_idx" ON "sessions" ("expires_at")`,
    );
    logger.info("Ensured sessions table exists");
  } catch (err) {
    logger.error({ err }, "Failed to ensure sessions table");
  }

  // 2) `users.password_hash` must be nullable: SSO users have no local password,
  //    and the boot-time strip of legacy passwords sets it to NULL. A leftover
  //    NOT NULL constraint makes that strip fail (legacy credentials survive)
  //    and can block creating a brand-new SSO user on first sign-in. DROP NOT
  //    NULL is a metadata-only no-op when the column is already nullable.
  try {
    await db.execute(
      sql`ALTER TABLE "users" ALTER COLUMN "password_hash" DROP NOT NULL`,
    );
    logger.info("Ensured users.password_hash is nullable");
  } catch (err) {
    logger.error({ err }, "Failed to ensure users.password_hash is nullable");
  }

  // 3) CIO-only "shadow memory" scratchpad. New table added after initial
  //    self-hosted setup, so create it on boot when missing. Mirrors
  //    lib/db/src/schema/cio_shadow_notes.ts.
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS "cio_shadow_notes" (
        "id" serial PRIMARY KEY NOT NULL,
        "week_of" varchar(20),
        "category" varchar(50) DEFAULT 'general' NOT NULL,
        "content" text NOT NULL,
        "status" varchar(20) DEFAULT 'open' NOT NULL,
        "source" varchar(20) DEFAULT 'ai' NOT NULL,
        "created_by" integer,
        "created_at" timestamp DEFAULT now() NOT NULL,
        "updated_at" timestamp DEFAULT now() NOT NULL
      )
    `);
    await db.execute(
      sql`CREATE INDEX IF NOT EXISTS "cio_shadow_notes_week_of_idx" ON "cio_shadow_notes" ("week_of")`,
    );
    logger.info("Ensured cio_shadow_notes table exists");
  } catch (err) {
    logger.error({ err }, "Failed to ensure cio_shadow_notes table");
  }

  // 4) Inventory audit trail for switch/VLAN writes. New table added after the
  //    initial self-hosted setup, so create it on boot when missing. Mirrors
  //    lib/db/src/schema/inventory_audit.ts.
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS "inventory_audit" (
        "id" serial PRIMARY KEY NOT NULL,
        "entity_type" varchar(20) NOT NULL,
        "entity_id" integer NOT NULL,
        "entity_label" varchar(255) NOT NULL,
        "action" varchar(20) NOT NULL,
        "source" varchar(20) NOT NULL,
        "actor_id" integer,
        "actor_name" varchar(255),
        "changes" jsonb DEFAULT '[]'::jsonb NOT NULL,
        "created_at" timestamp DEFAULT now() NOT NULL
      )
    `);
    await db.execute(
      sql`CREATE INDEX IF NOT EXISTS "inventory_audit_entity_idx" ON "inventory_audit" ("entity_type", "entity_id")`,
    );
    await db.execute(
      sql`CREATE INDEX IF NOT EXISTS "inventory_audit_created_at_idx" ON "inventory_audit" ("created_at")`,
    );
    logger.info("Ensured inventory_audit table exists");
  } catch (err) {
    logger.error({ err }, "Failed to ensure inventory_audit table");
  }

  // 5) Network-diagram layout governance: a change log (with position snapshots)
  //    for shared-layout resets/restores, and a singleton advisory edit lock.
  //    New tables added after initial self-hosted setup. Mirrors
  //    lib/db/src/schema/network_governance.ts.
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS "network_layout_events" (
        "id" serial PRIMARY KEY NOT NULL,
        "action" varchar(20) NOT NULL,
        "actor_id" integer,
        "actor_name" varchar(255),
        "node_count" integer DEFAULT 0 NOT NULL,
        "snapshot" jsonb DEFAULT '[]'::jsonb NOT NULL,
        "created_at" timestamp DEFAULT now() NOT NULL
      )
    `);
    await db.execute(
      sql`CREATE INDEX IF NOT EXISTS "network_layout_events_created_at_idx" ON "network_layout_events" ("created_at")`,
    );
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS "network_layout_lock" (
        "id" integer PRIMARY KEY NOT NULL,
        "locked_by_id" integer,
        "locked_by_name" varchar(255),
        "acquired_at" timestamp DEFAULT now() NOT NULL,
        "expires_at" timestamp NOT NULL
      )
    `);
    logger.info("Ensured network layout governance tables exist");
  } catch (err) {
    logger.error({ err }, "Failed to ensure network layout governance tables");
  }
}
