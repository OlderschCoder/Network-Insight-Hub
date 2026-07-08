-- =============================================================================
-- Patch: correct two wrong links from the initial seed
-- Run: psql "postgres://sccc:a-strong-password@localhost:5432/sccc_it" -f fix-network-map-links.sql
-- =============================================================================

-- 1) A48 Eth1/28 was seeded pointing to swa-scc (wrong — LLDP shows SWA-V201)
--    Fix: retarget b_node_id to SWA-V201 (Agriculture)
UPDATE net_links
SET
  b_node_id        = (SELECT id FROM net_nodes WHERE hostname = 'SWA-V201'),
  b_port           = '1/1/49',
  confidence       = 'confirmed_lldp',
  notes            = 'A48 Eth1/28 → Agriculture V201. Confirmed LLDP 2026-07-07.',
  updated_at       = now()
WHERE
  a_node_id = (SELECT id FROM net_nodes WHERE hostname = 'sw-aa144-A48')
  AND a_port = 'Eth1/28'
  AND b_node_id = (SELECT id FROM net_nodes WHERE hostname = 'swa-scc');

-- 2) A24 Eth1/26 → swa-scc was wrongly marked stale (it IS the current SharpCC uplink)
UPDATE net_links
SET
  confidence       = 'confirmed_lldp',
  last_verified_at = '2026-07-07T20:00:00Z'::timestamptz,
  notes            = 'SharpCC (swa-scc) uplink from A24 Eth1/26. Confirmed LLDP 2026-07-07.',
  updated_at       = now()
WHERE
  a_node_id = (SELECT id FROM net_nodes WHERE hostname = 'sw-aa144-A24')
  AND a_port = 'Eth1/26'
  AND b_node_id = (SELECT id FROM net_nodes WHERE hostname = 'swa-scc');

-- 3) Add missing NMBL server links (A48 Eth1/31-34)
INSERT INTO net_links (id, a_node_id, b_node_id, a_port, b_port, link_kind, speed_mbps, port_mode, confidence, last_verified_at, evidence_ref, notes)
SELECT gen_random_uuid(),
  (SELECT id FROM net_nodes WHERE hostname='sw-aa144-A48'),
  (SELECT id FROM net_nodes WHERE hostname='NMBL-LIVE1-B'),
  'Eth1/31','tg1/if3','fiber',10000,'trunk','confirmed_lldp',
  '2026-07-07T20:00:00Z'::timestamptz,'A48-lldp-2026-07-07.txt','NMBL-LIVE1-B port tg1/if3'
WHERE NOT EXISTS (
  SELECT 1 FROM net_links WHERE
    a_node_id=(SELECT id FROM net_nodes WHERE hostname='sw-aa144-A48') AND a_port='Eth1/31'
);

INSERT INTO net_links (id, a_node_id, b_node_id, a_port, b_port, link_kind, speed_mbps, port_mode, confidence, last_verified_at, evidence_ref, notes)
SELECT gen_random_uuid(),
  (SELECT id FROM net_nodes WHERE hostname='sw-aa144-A48'),
  (SELECT id FROM net_nodes WHERE hostname='NMBL-LIVE1-B'),
  'Eth1/32','tg2/if4','fiber',10000,'trunk','confirmed_lldp',
  '2026-07-07T20:00:00Z'::timestamptz,'A48-lldp-2026-07-07.txt','NMBL-LIVE1-B port tg2/if4'
WHERE NOT EXISTS (
  SELECT 1 FROM net_links WHERE
    a_node_id=(SELECT id FROM net_nodes WHERE hostname='sw-aa144-A48') AND a_port='Eth1/32'
);

INSERT INTO net_links (id, a_node_id, b_node_id, a_port, b_port, link_kind, speed_mbps, port_mode, confidence, last_verified_at, evidence_ref, notes)
SELECT gen_random_uuid(),
  (SELECT id FROM net_nodes WHERE hostname='sw-aa144-A48'),
  (SELECT id FROM net_nodes WHERE hostname='NMBL-LIVE1-A'),
  'Eth1/33','tg1/if3','fiber',10000,'trunk','confirmed_lldp',
  '2026-07-07T20:00:00Z'::timestamptz,'A48-lldp-2026-07-07.txt','NMBL-LIVE1-A port tg1/if3'
WHERE NOT EXISTS (
  SELECT 1 FROM net_links WHERE
    a_node_id=(SELECT id FROM net_nodes WHERE hostname='sw-aa144-A48') AND a_port='Eth1/33'
);

INSERT INTO net_links (id, a_node_id, b_node_id, a_port, b_port, link_kind, speed_mbps, port_mode, confidence, last_verified_at, evidence_ref, notes)
SELECT gen_random_uuid(),
  (SELECT id FROM net_nodes WHERE hostname='sw-aa144-A48'),
  (SELECT id FROM net_nodes WHERE hostname='NMBL-LIVE1-A'),
  'Eth1/34','tg2/if4','fiber',10000,'trunk','confirmed_lldp',
  '2026-07-07T20:00:00Z'::timestamptz,'A48-lldp-2026-07-07.txt','NMBL-LIVE1-A port tg2/if4'
WHERE NOT EXISTS (
  SELECT 1 FROM net_links WHERE
    a_node_id=(SELECT id FROM net_nodes WHERE hostname='sw-aa144-A48') AND a_port='Eth1/34'
);

-- Verify
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
WHERE n_a.hostname IN ('sw-aa144-A48','sw-aa144-A24')
ORDER BY n_a.hostname, l.a_port;
