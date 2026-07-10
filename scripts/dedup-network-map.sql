-- =============================================================================
-- dedup-network-map.sql  —  One-time cleanup for mixed-case hostname duplication
--
-- Background:
--   seed-network-map.sql used mixed-case hostnames (e.g. 'sw-aa144-A48').
--   The API's canonHostname() always lowercases, so POST /import/lldp created
--   new nodes (e.g. 'sw-aa144-a48') alongside the seeded ones, yielding two
--   UUID rows for the same physical switch. Links then fan out from both UUIDs,
--   dedup fails, and the visualizer shows ~5 links instead of ~20+.
--
-- What this script does (in order, inside a single transaction):
--   1) Merge duplicate node pairs (same LOWER(hostname), different UUIDs):
--      - Keep the node with mgmt_ip set (the seeded one); prefer it.
--      - Re-point all net_links a_node_id / b_node_id to the keeper UUID.
--      - Delete the orphan node.
--   2) Lowercase all remaining net_nodes hostnames.
--   3) Remove duplicate net_links rows (same physical port pair, both dirs):
--      - Canonical key = LEAST(a_node_id,b_node_id) + GREATEST(...) + both ports.
--      - Keep the row with highest confidence rank; break ties by newest last_verified_at.
--   4) Add a functional unique index on net_links to prevent future dupes.
--
-- Run ONCE against the live DB, then re-seed + re-import will be clean.
-- Run:
--   export $(grep -v '^#' /opt/sccc-it/.env.production | xargs)
--   psql "$DATABASE_URL" -f scripts/dedup-network-map.sql
-- =============================================================================

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) Merge duplicate node pairs caused by mixed-case hostnames
-- ─────────────────────────────────────────────────────────────────────────────

-- Build a map: orphan_id → keeper_id
-- "keeper" = the one with mgmt_ip set, or if both have it, the older row (smaller id lexicographically)
WITH dupes AS (
  SELECT
    a.id  AS id_a,
    b.id  AS id_b,
    a.hostname AS host_a,
    b.hostname AS host_b,
    a.mgmt_ip  AS mgmt_a,
    b.mgmt_ip  AS mgmt_b
  FROM net_nodes a
  JOIN net_nodes b
    ON LOWER(a.hostname) = LOWER(b.hostname)
    AND a.id < b.id          -- each pair once
  WHERE a.hostname <> b.hostname  -- only mixed-case duplicates
),
merge_map AS (
  SELECT
    -- Keeper = whichever has mgmt_ip; if both or neither, take the lexicographically smaller id
    CASE
      WHEN mgmt_a IS NOT NULL AND mgmt_b IS NULL THEN id_a
      WHEN mgmt_b IS NOT NULL AND mgmt_a IS NULL THEN id_b
      ELSE LEAST(id_a, id_b)
    END AS keeper_id,
    CASE
      WHEN mgmt_a IS NOT NULL AND mgmt_b IS NULL THEN id_b
      WHEN mgmt_b IS NOT NULL AND mgmt_a IS NULL THEN id_a
      ELSE GREATEST(id_a, id_b)
    END AS orphan_id
  FROM dupes
)
-- Re-point net_links.a_node_id
UPDATE net_links nl
SET a_node_id = m.keeper_id
FROM merge_map m
WHERE nl.a_node_id = m.orphan_id;

WITH dupes AS (
  SELECT
    a.id  AS id_a,
    b.id  AS id_b,
    a.mgmt_ip  AS mgmt_a,
    b.mgmt_ip  AS mgmt_b
  FROM net_nodes a
  JOIN net_nodes b
    ON LOWER(a.hostname) = LOWER(b.hostname)
    AND a.id < b.id
  WHERE a.hostname <> b.hostname
),
merge_map AS (
  SELECT
    CASE
      WHEN mgmt_a IS NOT NULL AND mgmt_b IS NULL THEN id_a
      WHEN mgmt_b IS NOT NULL AND mgmt_a IS NULL THEN id_b
      ELSE LEAST(id_a, id_b)
    END AS keeper_id,
    CASE
      WHEN mgmt_a IS NOT NULL AND mgmt_b IS NULL THEN id_b
      WHEN mgmt_b IS NOT NULL AND mgmt_a IS NULL THEN id_a
      ELSE GREATEST(id_a, id_b)
    END AS orphan_id
  FROM dupes
)
-- Re-point net_links.b_node_id
UPDATE net_links nl
SET b_node_id = m.keeper_id
FROM merge_map m
WHERE nl.b_node_id = m.orphan_id;

-- Delete self-links that were created when both ends collapsed to the same keeper
DELETE FROM net_links WHERE a_node_id = b_node_id;

-- Delete orphan nodes
WITH dupes AS (
  SELECT
    a.id  AS id_a,
    b.id  AS id_b,
    a.mgmt_ip  AS mgmt_a,
    b.mgmt_ip  AS mgmt_b
  FROM net_nodes a
  JOIN net_nodes b
    ON LOWER(a.hostname) = LOWER(b.hostname)
    AND a.id < b.id
  WHERE a.hostname <> b.hostname
),
merge_map AS (
  SELECT
    CASE
      WHEN mgmt_a IS NOT NULL AND mgmt_b IS NULL THEN id_b
      WHEN mgmt_b IS NOT NULL AND mgmt_a IS NULL THEN id_a
      ELSE GREATEST(id_a, id_b)
    END AS orphan_id
  FROM dupes
)
DELETE FROM net_nodes WHERE id IN (SELECT orphan_id FROM merge_map);


-- ─────────────────────────────────────────────────────────────────────────────
-- 2) Lowercase all remaining hostnames
-- ─────────────────────────────────────────────────────────────────────────────
-- Strip trailing prompt chars and lowercase in one pass
UPDATE net_nodes
SET hostname   = LOWER(REGEXP_REPLACE(hostname, '[#>()\s]+$', '')),
    updated_at = NOW()
WHERE hostname <> LOWER(REGEXP_REPLACE(hostname, '[#>()\s]+$', ''));


-- ─────────────────────────────────────────────────────────────────────────────
-- 3) Deduplicate net_links
--    Canonical key: sort node UUIDs so LEAST(a,b) is always "a-side"
--    then compare (a_node_id, a_port, b_node_id, b_port) ignoring direction.
-- ─────────────────────────────────────────────────────────────────────────────

-- Confidence ranking (higher = more authoritative)
-- confirmed_lldp=4, confirmed_cdp=3, manual=2, inferred=1, stale=0
WITH ranked AS (
  SELECT
    id,
    LEAST(a_node_id, b_node_id)    AS lo_node,
    GREATEST(a_node_id, b_node_id) AS hi_node,
    CASE WHEN a_node_id < b_node_id THEN a_port ELSE b_port END AS lo_port,
    CASE WHEN a_node_id < b_node_id THEN b_port ELSE a_port END AS hi_port,
    CASE confidence
      WHEN 'confirmed_lldp' THEN 4
      WHEN 'confirmed_cdp'  THEN 3
      WHEN 'manual'         THEN 2
      WHEN 'inferred'       THEN 1
      ELSE 0
    END AS conf_rank,
    last_verified_at
  FROM net_links
),
best AS (
  SELECT DISTINCT ON (lo_node, hi_node, lo_port, hi_port)
    id AS keep_id
  FROM ranked
  ORDER BY lo_node, hi_node, lo_port, hi_port, conf_rank DESC, last_verified_at DESC
)
DELETE FROM net_links
WHERE id NOT IN (SELECT keep_id FROM best);


-- ─────────────────────────────────────────────────────────────────────────────
-- 4) Ensure canonical a<b ordering in surviving rows
--    (so the unique index below works correctly)
-- ─────────────────────────────────────────────────────────────────────────────
UPDATE net_links
SET
  a_node_id = b_node_id,
  a_port    = b_port,
  b_node_id = a_node_id,
  b_port    = a_port,
  updated_at = NOW()
WHERE a_node_id > b_node_id;


-- ─────────────────────────────────────────────────────────────────────────────
-- 5) Add unique index on net_links to prevent future duplicates
--    Uses canonical ordering (a_node_id < b_node_id enforced by constraint above)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE UNIQUE INDEX IF NOT EXISTS net_links_canonical_uq
  ON net_links (
    LEAST(a_node_id, b_node_id),
    GREATEST(a_node_id, b_node_id),
    CASE WHEN a_node_id < b_node_id THEN a_port ELSE b_port END,
    CASE WHEN a_node_id < b_node_id THEN b_port ELSE a_port END
  );


-- ─────────────────────────────────────────────────────────────────────────────
-- Verification
-- ─────────────────────────────────────────────────────────────────────────────
SELECT 'After dedup:' AS status;

SELECT
  n_a.hostname AS "from",
  l.a_port,
  n_b.hostname AS "to",
  l.b_port,
  l.confidence,
  l.speed_mbps
FROM net_links l
JOIN net_nodes n_a ON n_a.id = l.a_node_id
JOIN net_nodes n_b ON n_b.id = l.b_node_id
ORDER BY n_a.hostname, l.a_port;

SELECT 'net_nodes' AS tbl, COUNT(*) AS rows FROM net_nodes
UNION ALL
SELECT 'net_links',        COUNT(*)          FROM net_links;

COMMIT;
