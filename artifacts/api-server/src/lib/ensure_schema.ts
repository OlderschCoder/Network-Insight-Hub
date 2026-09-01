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
  try {
    await db.execute(sql`CREATE TABLE IF NOT EXISTS "fred_architecture_snapshots" (
      "id" bigserial PRIMARY KEY,
      "generated_by" integer REFERENCES "users"("id") ON DELETE SET NULL,
      "generated_at" timestamptz NOT NULL DEFAULT now(),
      "evidence" jsonb NOT NULL,
      "summary" jsonb NOT NULL,
      "report" text NOT NULL,
      "verification" text NOT NULL DEFAULT '',
      "models" jsonb NOT NULL DEFAULT '{}'::jsonb
    )`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS "fred_architecture_snapshots_generated_idx" ON "fred_architecture_snapshots" ("generated_at" DESC)`);
    logger.info("Ensured durable Fred architecture snapshots table exists");
  } catch (err) {
    logger.error({ err }, "Failed to ensure Fred architecture snapshots table");
  }

  try {
    await db.execute(sql`CREATE TABLE IF NOT EXISTS "fred_chat_sessions" (
      "id" bigserial PRIMARY KEY,
      "user_id" integer NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
      "title" varchar(200) NOT NULL DEFAULT 'Fred conversation',
      "messages" jsonb NOT NULL DEFAULT '[]'::jsonb,
      "checkpoint" text NOT NULL DEFAULT '',
      "is_active" boolean NOT NULL DEFAULT true,
      "created_at" timestamptz NOT NULL DEFAULT now(),
      "updated_at" timestamptz NOT NULL DEFAULT now()
    )`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS "fred_chat_sessions_user_updated_idx" ON "fred_chat_sessions" ("user_id", "updated_at" DESC)`);
    await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS "fred_chat_sessions_one_active_idx" ON "fred_chat_sessions" ("user_id") WHERE "is_active" = true`);
    logger.info("Ensured durable Fred chat sessions table exists");
  } catch (err) {
    logger.error({ err }, "Failed to ensure durable Fred chat sessions table");
  }

  try {
    await db.execute(sql`CREATE TABLE IF NOT EXISTS "learn_scenario_progress" (
      "id" bigserial PRIMARY KEY,
      "user_id" integer NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
      "scenario_id" varchar(100) NOT NULL,
      "current_step" integer DEFAULT 0 NOT NULL,
      "status" varchar(20) DEFAULT 'not_started' NOT NULL,
      "attempts" integer DEFAULT 0 NOT NULL,
      "history" jsonb DEFAULT '[]'::jsonb NOT NULL,
      "started_at" timestamptz DEFAULT now() NOT NULL,
      "completed_at" timestamptz,
      "updated_at" timestamptz DEFAULT now() NOT NULL,
      UNIQUE ("user_id", "scenario_id")
    )`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS "learn_progress_user_idx" ON "learn_scenario_progress" ("user_id", "status")`);
    logger.info("Ensured Learn scenario progress table exists");
  } catch (err) {
    logger.error({ err }, "Failed to ensure Learn scenario progress table");
  }
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

  // Fred's operational-record audit trail. This is separate from the switch /
  // VLAN inventory audit because it also covers risks, PIRs, goals, projects,
  // processes, weekly entries, and building changes.
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS "fred_record_audit" (
        "id" serial PRIMARY KEY NOT NULL,
        "resource" varchar(40) NOT NULL,
        "action" varchar(20) NOT NULL,
        "identifier" varchar(255) NOT NULL,
        "label" varchar(500) NOT NULL,
        "actor_id" integer,
        "actor_name" varchar(255),
        "before" jsonb,
        "after" jsonb,
        "created_at" timestamp DEFAULT now() NOT NULL
      )
    `);
    await db.execute(
      sql`CREATE INDEX IF NOT EXISTS "fred_record_audit_resource_idx" ON "fred_record_audit" ("resource", "identifier")`,
    );
    await db.execute(
      sql`CREATE INDEX IF NOT EXISTS "fred_record_audit_created_at_idx" ON "fred_record_audit" ("created_at")`,
    );
    logger.info("Ensured fred_record_audit table exists");
  } catch (err) {
    logger.error({ err }, "Failed to ensure fred_record_audit table");
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

  // 6) Azure sync run log. Records each VM/resource sync (success/failure,
  //    counts, error detail, and a per-VM diff) so the inventory views can show
  //    a sync-status indicator and post-sync change view. New table added after
  //    initial self-hosted setup. Mirrors lib/db/src/schema/azure_sync_runs.ts.
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS "azure_sync_runs" (
        "id" serial PRIMARY KEY NOT NULL,
        "kind" varchar(20) NOT NULL,
        "status" varchar(20) NOT NULL,
        "error" text,
        "created_count" integer DEFAULT 0 NOT NULL,
        "updated_count" integer DEFAULT 0 NOT NULL,
        "removed_count" integer DEFAULT 0 NOT NULL,
        "total_count" integer DEFAULT 0 NOT NULL,
        "changed_count" integer DEFAULT 0 NOT NULL,
        "diff" jsonb DEFAULT '{"added":[],"removed":[],"changed":[]}'::jsonb NOT NULL,
        "actor_id" integer,
        "actor_name" varchar(255),
        "created_at" timestamp DEFAULT now() NOT NULL
      )
    `);
    await db.execute(
      sql`CREATE INDEX IF NOT EXISTS "azure_sync_runs_kind_created_idx" ON "azure_sync_runs" ("kind", "created_at")`,
    );
    logger.info("Ensured azure_sync_runs table exists");
  } catch (err) {
    logger.error({ err }, "Failed to ensure azure_sync_runs table");
  }

  // 8) Network Map — nodes, links, OSPF adjacencies.
  //    UUID-keyed tables for physical topology documentation.
  //    Uses ensure-table pattern so self-hosted installs self-heal on boot.
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS "net_nodes" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        "hostname" varchar(80) NOT NULL,
        "display_name" varchar(120) NOT NULL,
        "node_kind" varchar(20) NOT NULL,
        "vendor" varchar(20),
        "model" varchar(80),
        "mgmt_ip" varchar(45),
        "building" varchar(80) NOT NULL,
        "location" varchar(120),
        "role" varchar(20) NOT NULL,
        "function" varchar(30),
        "criticality" varchar(10) NOT NULL DEFAULT 'medium',
        "tags" text[],
        "status" varchar(10),
        "notes" text,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS "net_nodes_mgmt_ip_idx" ON "net_nodes" ("mgmt_ip")`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS "net_nodes_building_idx" ON "net_nodes" ("building")`);
    await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS "net_nodes_hostname_uq" ON "net_nodes" ("hostname")`);
    logger.info("Ensured net_nodes table exists");
  } catch (err) {
    logger.error({ err }, "Failed to ensure net_nodes table");
  }

  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS "net_links" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        "a_node_id" uuid NOT NULL REFERENCES "net_nodes"("id") ON DELETE CASCADE,
        "a_port" varchar(40) NOT NULL,
        "b_node_id" uuid NOT NULL REFERENCES "net_nodes"("id") ON DELETE CASCADE,
        "b_port" varchar(40) NOT NULL,
        "link_kind" varchar(12) NOT NULL,
        "speed_mbps" integer,
        "port_mode" varchar(12),
        "native_vlan" integer,
        "allowed_vlans" integer[],
        "portchannel" varchar(20),
        "lldp_peer_hostname" varchar(80),
        "lldp_peer_mgmt_ip" varchar(45),
        "confidence" varchar(20) NOT NULL,
        "last_verified_at" timestamptz NOT NULL,
        "evidence_ref" varchar(200),
        "notes" text,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS "net_links_a_node_idx" ON "net_links" ("a_node_id")`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS "net_links_b_node_idx" ON "net_links" ("b_node_id")`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS "net_links_last_verified_idx" ON "net_links" ("last_verified_at")`);
    logger.info("Ensured net_links table exists");
  } catch (err) {
    logger.error({ err }, "Failed to ensure net_links table");
  }

  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS "net_ports" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        "node_id" uuid NOT NULL REFERENCES "net_nodes"("id") ON DELETE CASCADE,
        "interface_name" varchar(80) NOT NULL,
        "if_index" integer,
        "is_physical" boolean NOT NULL DEFAULT true,
        "description" text,
        "if_type" integer,
        "mtu" integer,
        "mac_address" varchar(32),
        "admin_status" varchar(12),
        "oper_status" varchar(12),
        "status_reason" varchar(120),
        "speed_mbps" integer,
        "duplex" varchar(12),
        "media_type" varchar(80),
        "port_mode" varchar(12),
        "native_vlan" integer,
        "allowed_vlans" integer[],
        "portchannel" varchar(40),
        "vpc_id" integer,
        "mac_count" integer NOT NULL DEFAULT 0,
        "lldp_neighbor_count" integer NOT NULL DEFAULT 0,
        "in_errors" bigint,
        "out_errors" bigint,
        "in_discards" bigint,
        "out_discards" bigint,
        "in_octets" numeric(30,0),
        "out_octets" numeric(30,0),
        "in_bps" bigint,
        "out_bps" bigint,
        "utilization_pct" real,
        "rx_power_dbm" real,
        "tx_power_dbm" real,
        "temperature_c" real,
        "optics_status" varchar(20),
        "config_evidence" varchar(300),
        "telemetry_evidence" varchar(300),
        "config_updated_at" timestamptz,
        "telemetry_updated_at" timestamptz,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS "net_ports_node_interface_uq" ON "net_ports" ("node_id", "interface_name")`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS "net_ports_node_idx" ON "net_ports" ("node_id")`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS "net_ports_telemetry_updated_idx" ON "net_ports" ("telemetry_updated_at")`);
    await db.execute(sql`ALTER TABLE "net_ports" ADD COLUMN IF NOT EXISTS "status_reason" varchar(120)`);
    await db.execute(sql`ALTER TABLE "net_ports" ADD COLUMN IF NOT EXISTS "media_type" varchar(80)`);
    await db.execute(sql`ALTER TABLE "net_ports" ADD COLUMN IF NOT EXISTS "mac_count" integer NOT NULL DEFAULT 0`);
    await db.execute(sql`ALTER TABLE "net_ports" ADD COLUMN IF NOT EXISTS "lldp_neighbor_count" integer NOT NULL DEFAULT 0`);
    logger.info("Ensured net_ports table exists");
  } catch (err) {
    logger.error({ err }, "Failed to ensure net_ports table");
  }

  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS "net_routing_adjacencies" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        "device_node_id" uuid NOT NULL REFERENCES "net_nodes"("id") ON DELETE CASCADE,
        "protocol" varchar(10) NOT NULL,
        "process" varchar(20),
        "area" varchar(16),
        "local_interface" varchar(40) NOT NULL,
        "local_ip" varchar(45),
        "peer_router_id" varchar(45),
        "peer_ip" varchar(45),
        "state" varchar(10) NOT NULL,
        "last_seen_at" timestamptz NOT NULL,
        "evidence_ref" varchar(200),
        "notes" text,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS "net_routing_adj_device_idx" ON "net_routing_adjacencies" ("device_node_id")`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS "net_routing_adj_state_idx" ON "net_routing_adjacencies" ("state")`);
    logger.info("Ensured net_routing_adjacencies table exists");
  } catch (err) {
    logger.error({ err }, "Failed to ensure net_routing_adjacencies table");
  }

  // 9) Local campus-building assignments for Webex Calling people. Webex is
  //    authoritative for the person and number; this table stores only the
  //    Insight Hub building label so editing it cannot move or reprovision a
  //    calling user in Control Hub. The event table preserves every change.
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS "phone_building_assignments" (
        "webex_person_id" text PRIMARY KEY NOT NULL,
        "building" varchar(120) NOT NULL,
        "updated_by_id" integer REFERENCES "users"("id") ON DELETE SET NULL,
        "updated_by_name" varchar(255),
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS "phone_building_assignments_building_idx"
      ON "phone_building_assignments" ("building")
    `);
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS "phone_building_assignment_events" (
        "id" bigserial PRIMARY KEY NOT NULL,
        "webex_person_id" text NOT NULL,
        "person_name" varchar(255),
        "phone_number" varchar(80),
        "previous_building" varchar(120),
        "new_building" varchar(120),
        "actor_id" integer REFERENCES "users"("id") ON DELETE SET NULL,
        "actor_name" varchar(255),
        "created_at" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS "phone_building_assignment_events_person_idx"
      ON "phone_building_assignment_events" ("webex_person_id", "created_at")
    `);
    logger.info("Ensured phone building assignment tables exist");
  } catch (err) {
    logger.error({ err }, "Failed to ensure phone building assignment tables");
  }

  // 10) Durable Webex Calling CDR history for the IT 1200 report. Only
  //     operational call-leg metadata is retained; caller names/numbers are
  //     deliberately excluded from this reporting store.
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS "webex_it_call_legs" (
        "report_id" text PRIMARY KEY NOT NULL,
        "correlation_id" text NOT NULL,
        "start_time" timestamptz NOT NULL,
        "answer_time" timestamptz,
        "release_time" timestamptz,
        "answered" boolean DEFAULT false NOT NULL,
        "ring_duration_seconds" integer DEFAULT 0 NOT NULL,
        "duration_seconds" integer DEFAULT 0 NOT NULL,
        "user_id" text,
        "user_name" varchar(255),
        "user_type" varchar(40),
        "called_number" varchar(80),
        "redirecting_number" varchar(80),
        "is_hunt_group_leg" boolean DEFAULT false NOT NULL,
        "ingested_at" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS "webex_it_call_legs_start_idx" ON "webex_it_call_legs" ("start_time")`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS "webex_it_call_legs_correlation_idx" ON "webex_it_call_legs" ("correlation_id")`);
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS "webex_it_call_sync_state" (
        "id" integer PRIMARY KEY NOT NULL,
        "backfill_cursor" timestamptz,
        "last_success_at" timestamptz,
        "last_error" text,
        "updated_at" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await db.execute(sql`INSERT INTO "webex_it_call_sync_state" ("id") VALUES (1) ON CONFLICT ("id") DO NOTHING`);
    logger.info("Ensured Webex IT call history tables exist");
  } catch (err) {
    logger.error({ err }, "Failed to ensure Webex IT call history tables");
  }

  // 7) reports.include_cloud_inventory: opt-in flag to attach the Azure cloud
  //    inventory snapshot to a weekly report. New column added after initial
  //    setup; ADD COLUMN IF NOT EXISTS is a no-op when already present.
  try {
    await db.execute(
      sql`ALTER TABLE "reports" ADD COLUMN IF NOT EXISTS "include_cloud_inventory" boolean DEFAULT false NOT NULL`,
    );
    logger.info("Ensured reports.include_cloud_inventory column exists");
  } catch (err) {
    logger.error({ err }, "Failed to ensure reports.include_cloud_inventory column");
  }

  // Product engagement is distinct from work records. A task assignment or PIR
  // proves ownership/contribution, not that the assignee signed in or viewed a
  // page. This event stream captures only authenticated page views, bounded
  // foreground heartbeats, and explicit Fred messages.
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS "product_usage_events" (
        "id" bigserial PRIMARY KEY,
        "user_id" integer NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
        "client_session_id" varchar(64) NOT NULL,
        "event_type" varchar(24) NOT NULL,
        "path" varchar(500) NOT NULL,
        "duration_seconds" integer DEFAULT 0 NOT NULL,
        "created_at" timestamptz DEFAULT now() NOT NULL,
        CONSTRAINT "product_usage_events_type_check" CHECK ("event_type" IN ('page_view', 'heartbeat', 'fred_message')),
        CONSTRAINT "product_usage_events_duration_check" CHECK ("duration_seconds" BETWEEN 0 AND 120)
      )
    `);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS "product_usage_events_user_time_idx" ON "product_usage_events" ("user_id", "created_at")`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS "product_usage_events_path_time_idx" ON "product_usage_events" ("path", "created_at")`);
    logger.info("Ensured product usage event table exists");
  } catch (err) {
    logger.error({ err }, "Failed to ensure product usage event table");
  }
}
