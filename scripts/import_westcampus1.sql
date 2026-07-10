-- =============================================================================
-- Import: sw-westcampus-1  (Aruba AOS-CX FL.10.13.0005, VSF 2×JL659A)
-- Source: manual CLI capture 2026-07-09
-- Run:  psql "postgres://sccc:a-strong-password@localhost:5432/sccc_it" -f import_westcampus1.sql
-- =============================================================================

BEGIN;

-- ── 1. NODES ─────────────────────────────────────────────────────────────────

INSERT INTO net_nodes
  (hostname, display_name, node_kind, vendor, model, mgmt_ip, building, location,
   role, function, criticality, tags, status, notes)
VALUES
  -- Primary switch (VSF stack, Layer-3 distribution with SVI routing + DHCP server)
  (
    'sw-westcampus-1',
    'West Campus Switch 1',
    'switch', 'Aruba', 'JL659A (VSF 2-member)', '172.25.0.2',
    'West Campus', 'IDF West Campus',
    'distribution', 'Switching/Routing', 'high',
    ARRAY['aruba','aos-cx','vsf','layer3','dhcp-server'],
    'active',
    'ArubaOS-CX FL.10.13.0005 | VSF member 1 link 1/1/50 member 2 link 2/1/51 | '
    'Trunk uplinks: 1/1/49→sw-westcampus-2, 1/1/51→6300 | '
    'DHCP server for VLANs 1,910-915 | Routes via 172.25.0.1 default GW | '
    'VLANs 916-921 use ip helper 10.40.1.40'
  ),
  -- sw-westcampus-2  (discovered via LLDP on 1/1/49)
  (
    'sw-westcampus-2',
    'West Campus Switch 2',
    'switch', 'Aruba', 'JL659A FL.10.13.0005', '172.25.0.3',
    'West Campus', NULL,
    'access', 'Switching', 'high',
    ARRAY['aruba','aos-cx','lldp-discovered'],
    'active',
    'Discovered via LLDP on sw-westcampus-1 port 1/1/49'
  ),
  -- 6300  (discovered via LLDP on 1/1/51, mgmt 172.25.0.92)
  (
    '6300',
    'West Campus 6300',
    'switch', 'Aruba', 'JL659A FL.10.09.1000', '172.25.0.92',
    'West Campus', NULL,
    'distribution', 'Switching', 'high',
    ARRAY['aruba','aos-cx','lldp-discovered'],
    'active',
    'Discovered via LLDP on sw-westcampus-1 port 1/1/51. Older firmware FL.10.09.1000'
  ),
  -- switch3221cd  (discovered via LLDP on 1/1/41, Bridge+Router, mgmt 172.25.0.234)
  (
    'switch3221cd',
    'Switch 3221CD',
    'switch', NULL, NULL, '172.25.0.234',
    'West Campus', NULL,
    'access', 'Switching/Routing', 'medium',
    ARRAY['lldp-discovered','bridge','router'],
    'active',
    'Discovered via LLDP on sw-westcampus-1 port 1/1/41. Chassis 6c:29:d2:32:21:cd. Port gi14'
  ),
  -- LP-AA152MB-01  (CLASS_I MED endpoint, seen on ports 1/1/9 and 1/1/31)
  (
    'LP-AA152MB-01',
    'LP-AA152MB-01',
    'endpoint', NULL, NULL, NULL,
    'West Campus', NULL,
    'access', 'Endpoint', 'low',
    ARRAY['lldp-discovered','endpoint','med-class-i'],
    'active',
    'Discovered via LLDP on sw-westcampus-1 ports 1/1/9 and 1/1/31. MAC 80:3f:5d:d0:bf:19. MED CLASS_I device'
  )
ON CONFLICT (hostname) DO UPDATE SET
  display_name     = EXCLUDED.display_name,
  node_kind        = EXCLUDED.node_kind,
  vendor           = EXCLUDED.vendor,
  model            = EXCLUDED.model,
  mgmt_ip          = EXCLUDED.mgmt_ip,
  building         = EXCLUDED.building,
  role             = EXCLUDED.role,
  function         = EXCLUDED.function,
  criticality      = EXCLUDED.criticality,
  tags             = EXCLUDED.tags,
  status           = EXCLUDED.status,
  notes            = EXCLUDED.notes,
  updated_at       = now();

-- ── 2. LINKS ─────────────────────────────────────────────────────────────────
-- Using CTEs to resolve hostnames → UUIDs cleanly

WITH nodes AS (
  SELECT id, hostname FROM net_nodes
  WHERE hostname IN ('sw-westcampus-1','sw-westcampus-2','6300','switch3221cd','LP-AA152MB-01')
)
INSERT INTO net_links
  (a_node_id, a_port, b_node_id, b_port,
   link_kind, speed_mbps, port_mode, native_vlan, allowed_vlans,
   lldp_peer_hostname, lldp_peer_mgmt_ip,
   confidence, last_verified_at, evidence_ref, notes)
SELECT * FROM (

  -- 1/1/49 → sw-westcampus-2  (25G trunk uplink)
  SELECT
    (SELECT id FROM nodes WHERE hostname='sw-westcampus-1'), '1/1/49',
    (SELECT id FROM nodes WHERE hostname='sw-westcampus-2'), '1/1/49',
    'uplink', 25000, 'trunk', 1,
    ARRAY[1,910,911,912,913,914,915,916,917,918,919,920,921],
    'sw-westcampus-2', '172.25.0.3',
    'lldp', now(), 'show lldp neighbor detail 2026-07-09',
    '25G-LR uplink to sw-westcampus-2'

  UNION ALL

  -- 1/1/51 → 6300  (25G trunk uplink)
  SELECT
    (SELECT id FROM nodes WHERE hostname='sw-westcampus-1'), '1/1/51',
    (SELECT id FROM nodes WHERE hostname='6300'), '1/1/49',
    'uplink', 25000, 'trunk', 1,
    ARRAY[1,910,911,912,913,914,915,916,917,918,919,920,921],
    '6300', '172.25.0.92',
    'lldp', now(), 'show lldp neighbor detail 2026-07-09',
    '25G-LR uplink to 6300 (FL.10.09.1000)'

  UNION ALL

  -- 1/1/41 → switch3221cd gi14  (1G access)
  SELECT
    (SELECT id FROM nodes WHERE hostname='sw-westcampus-1'), '1/1/41',
    (SELECT id FROM nodes WHERE hostname='switch3221cd'), 'gi14',
    'access', 1000, 'access', 1, ARRAY[1],
    'switch3221cd', '172.25.0.234',
    'lldp', now(), 'show lldp neighbor detail 2026-07-09',
    '1G link to switch3221cd (Bridge/Router, 172.25.0.234)'

  UNION ALL

  -- 1/1/9 → LP-AA152MB-01
  SELECT
    (SELECT id FROM nodes WHERE hostname='sw-westcampus-1'), '1/1/9',
    (SELECT id FROM nodes WHERE hostname='LP-AA152MB-01'), '80:3f:5d:d0:bf:19',
    'access', 1000, 'access', 1, ARRAY[1],
    'LP-AA152MB-01', NULL,
    'lldp', now(), 'show lldp neighbor detail 2026-07-09',
    'MED CLASS_I endpoint on port 1/1/9'

  UNION ALL

  -- 1/1/31 → LP-AA152MB-01  (same MAC, second port)
  SELECT
    (SELECT id FROM nodes WHERE hostname='sw-westcampus-1'), '1/1/31',
    (SELECT id FROM nodes WHERE hostname='LP-AA152MB-01'), '80:3f:5d:d0:bf:19',
    'access', 1000, 'access', 1, ARRAY[1],
    'LP-AA152MB-01', NULL,
    'lldp', now(), 'show lldp neighbor detail 2026-07-09',
    'MED CLASS_I endpoint on port 1/1/31 (same MAC as 1/1/9 - possibly bonded or dual-homed)'

) links;

-- ── 3. VERIFY ────────────────────────────────────────────────────────────────

SELECT hostname, display_name, node_kind, mgmt_ip, building, role
FROM net_nodes
WHERE hostname IN ('sw-westcampus-1','sw-westcampus-2','6300','switch3221cd','LP-AA152MB-01')
ORDER BY hostname;

SELECT
  a.hostname AS from_node, l.a_port,
  b.hostname AS to_node,  l.b_port,
  l.link_kind, l.speed_mbps
FROM net_links l
JOIN net_nodes a ON a.id = l.a_node_id
JOIN net_nodes b ON b.id = l.b_node_id
WHERE a.hostname = 'sw-westcampus-1'
   OR b.hostname = 'sw-westcampus-1'
ORDER BY l.speed_mbps DESC, l.a_port;

COMMIT;
