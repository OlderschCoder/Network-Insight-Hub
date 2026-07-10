-- =============================================================================
-- Network Map Seed — SCCC Campus Topology
-- Generated: 2026-07-07  Source: LLDP/CDP from A48 + A24 (confirmed)
-- Run:
--   export $(grep -v '^#' /opt/sccc-it/.env.production | xargs)
--   psql "$DATABASE_URL" -f scripts/seed-network-map.sql
-- =============================================================================

-- -------------------------
-- 1) NODES  (upsert by hostname)
-- -------------------------
INSERT INTO net_nodes
  (id, hostname, display_name, node_kind, vendor, model, mgmt_ip,
   building, location, role, function, criticality, tags, status)
VALUES

-- Hobble AA-158 Core Nexus pair
(gen_random_uuid(),'sw-aa144-a48','Nexus Core 1 (Hobble AA-158)','switch','Cisco','N9K-C93180YC-EX','192.168.2.70',
 'Hobble','AA-158 IT room','core','general','critical',ARRAY['core','hobble'],'online'),

(gen_random_uuid(),'sw-aa144-a24','Nexus Core 2 (Hobble AA-158)','switch','Cisco','N9K-C93180YC-EX-24','192.168.2.71',
 'Hobble','AA-158 IT room','core','general','critical',ARRAY['core','hobble'],'online'),

-- Tech MDF Core Nexus pair
(gen_random_uuid(),'sw-t122-T48','Tech Core 3 (sw-t122-T48)','switch','Cisco','Nexus','192.168.2.72',
 'Industrial Tech (T122)','T122 MDF','core','general','high',ARRAY['tech_core'],'online'),

(gen_random_uuid(),'sw-t122-T24','Tech Core 4 (sw-t122-T24)','switch','Cisco','Nexus','192.168.2.73',
 'Industrial Tech (T122)','T122 MDF','core','general','high',ARRAY['tech_core'],'online'),

-- Firewall
(gen_random_uuid(),'fortigate1-sccc','FortiGate Firewall (Hobble AA-158)','firewall','Fortinet','FortiGate','192.168.1.1',
 'Hobble','AA-158 IT room','firewall','general','critical',ARRAY['perimeter'],'online'),

-- Hobble access layer
(gen_random_uuid(),'sw-aa144-access','sw-aa144-access (Cisco 3750)','switch','Cisco','WS-C3750','192.168.2.4',
 'Hobble','AA144','access','general','high',ARRAY['legacy_cisco'],'online'),

(gen_random_uuid(),'swa-aa144-access','swa-aa144-access (Aruba)','switch','Aruba','JL659A','192.168.2.1',
 'Hobble','AA144','access','general','critical',ARRAY['core_access'],'online'),

(gen_random_uuid(),'sw-a144-1-aruba','Hobble Access Stack 1','switch','Aruba','JL659A','192.168.2.201',
 'Hobble','AA144','access','general','high',ARRAY['hobble_access'],'online'),

(gen_random_uuid(),'sw-a144-2-aruba','Hobble Access Stack 2','switch','Aruba','JL659A','192.168.2.202',
 'Hobble','AA144','access','general','high',ARRAY['hobble_access'],'online'),

(gen_random_uuid(),'swa-aa105','AA105 (swa-aa105)','switch','Aruba','JL659A','192.168.2.199',
 'Hobble','AA105','access','general','high',ARRAY['aa105'],'online'),

(gen_random_uuid(),'sw-aa148-aruba','sw-aa148-aruba','switch','Aruba','JL660A','192.168.2.41',
 'Hobble','AA148','access','general','medium',ARRAY['aa148'],'online'),

(gen_random_uuid(),'sw-e208','E208 (Cisco switch)','switch','Cisco','WS-C3750','192.168.2.24',
 'Hobble','E208','access','general','medium',ARRAY['legacy_cisco'],'online'),

(gen_random_uuid(),'swa-a161','Testing Center (swa-a161)','switch','Aruba','JL659A','192.168.2.197',
 'Hobble','Testing Center','access','general','medium',ARRAY['testing'],'online'),

-- Calvin Allied Health
(gen_random_uuid(),'cah','Calvin Allied Health (CAH)','switch','Aruba','JL659A','192.168.2.216',
 'Calvin Allied Health (CAH)','IDF','access','general','high',ARRAY['cah'],'online'),

-- Humanities
(gen_random_uuid(),'swa-h128','Humanities H128','switch','Aruba','JL659A','172.20.2.6',
 'Humanities (H128)','IDF','access','general','medium',ARRAY['humanities'],'online'),

-- Sharp Champion Center (Athletics)
(gen_random_uuid(),'swa-scc','Sharp Champion Center Stack','switch','Aruba','JL659A (6300M VSF)','192.168.2.203',
 'Sharp Champion Center','IDF','access','athletics','high',ARRAY['sharpcc','athletics'],'online'),

-- Student housing / services
(gen_random_uuid(),'swa-slc151','Student Living Center (SLC151)','switch','Aruba','JL659A','192.168.2.175',
 'Student Living Center (SLC151)','IDF','access','dorms','high',ARRAY['student_housing'],'online'),

(gen_random_uuid(),'swa-su121','Student Union (SU121)','switch','Aruba','JL659A','192.168.2.200',
 'Student Union (SU121)','IDF','access','student_union','high',ARRAY['student_union'],'online'),

(gen_random_uuid(),'sw-sa208','SA208 (sw-sa208)','switch','Aruba','JL659A','192.168.2.194',
 'Student Union / SA208','IDF','access','student_union','high',ARRAY['student_union'],'online'),

(gen_random_uuid(),'sw-healthcenter','Health Center','switch','Aruba','JL659A','192.168.2.212',
 'Student Health Center','IDF','access','health_center','high',ARRAY['health_center'],'online'),

-- Athletics
(gen_random_uuid(),'sw-softballpb','Softball Pressbox','switch','Aruba','JL679A','192.168.2.204',
 'Softball Field','Pressbox','access','athletics','medium',ARRAY['athletics'],'online'),

(gen_random_uuid(),'swa-v201','Agriculture V201','switch','Aruba','JL659A','192.168.2.195',
 'Agriculture (V201)','IDF','access','general','medium',ARRAY['ag'],'online'),

-- Servers
(gen_random_uuid(),'nmbl-live1-a','nmbl-live1-a (Linux server)','server','Unknown','Linux',NULL,
 'Hobble','AA144','edge','general','medium',ARRAY['server'],'online'),

(gen_random_uuid(),'nmbl-live1-b','nmbl-live1-b (Linux server)','server','Unknown','Linux',NULL,
 'Hobble','AA144','edge','general','medium',ARRAY['server'],'online')

ON CONFLICT (hostname) DO UPDATE SET
  display_name   = EXCLUDED.display_name,
  node_kind      = EXCLUDED.node_kind,
  vendor         = EXCLUDED.vendor,
  model          = EXCLUDED.model,
  mgmt_ip        = EXCLUDED.mgmt_ip,
  building       = EXCLUDED.building,
  location       = EXCLUDED.location,
  role           = EXCLUDED.role,
  function       = EXCLUDED.function,
  criticality    = EXCLUDED.criticality,
  tags           = EXCLUDED.tags,
  status         = EXCLUDED.status,
  updated_at     = now();


-- -------------------------
-- 2) LINKS  (resolved by hostname subquery, canonical A<B ordering enforced in notes)
--    Duplicate guard: ON CONFLICT on (a_node_id, a_port, b_node_id, b_port) would need
--    a unique index — for now the WHERE NOT EXISTS guard prevents exact-match dupes.
-- -------------------------

-- Helper function (idempotent): resolves hostname → id
-- We use inline subqueries throughout.

-- vPC peer-link  A48 <-> A24 (DAC, 100G)
INSERT INTO net_links (id, a_node_id, b_node_id, a_port, b_port, link_kind, speed_mbps, port_mode, confidence, last_verified_at, evidence_ref, notes)
SELECT gen_random_uuid(),
  (SELECT id FROM net_nodes WHERE hostname='sw-aa144-a48'),
  (SELECT id FROM net_nodes WHERE hostname='sw-aa144-a24'),
  'Eth1/49','Eth1/49','dac',100000,'peerlink','confirmed_lldp',
  '2026-07-07T20:00:00Z'::timestamptz,'A48-lldp-2026-07-07.txt','vPC peer-link between AA144 Nexus pair'
WHERE NOT EXISTS (
  SELECT 1 FROM net_links WHERE
    a_node_id=(SELECT id FROM net_nodes WHERE hostname='sw-aa144-a48') AND a_port='Eth1/49' AND
    b_node_id=(SELECT id FROM net_nodes WHERE hostname='sw-aa144-a24') AND b_port='Eth1/49'
);

-- Heartbeat  A48 <-> A24 (fiber, 1G, VLAN17)
INSERT INTO net_links (id, a_node_id, b_node_id, a_port, b_port, link_kind, speed_mbps, port_mode, native_vlan, confidence, last_verified_at, evidence_ref, notes)
SELECT gen_random_uuid(),
  (SELECT id FROM net_nodes WHERE hostname='sw-aa144-a48'),
  (SELECT id FROM net_nodes WHERE hostname='sw-aa144-a24'),
  'Eth1/16','Eth1/16','fiber',1000,'heartbeat',17,'confirmed_cdp',
  '2026-07-07T20:00:00Z'::timestamptz,'A48-cdp-2026-07-07.txt','Heartbeat link (native VLAN 17)'
WHERE NOT EXISTS (
  SELECT 1 FROM net_links WHERE
    a_node_id=(SELECT id FROM net_nodes WHERE hostname='sw-aa144-a48') AND a_port='Eth1/16' AND
    b_node_id=(SELECT id FROM net_nodes WHERE hostname='sw-aa144-a24') AND b_port='Eth1/16'
);

-- A48 Eth1/5 -> swa-a161 (Testing Center, 1G)
INSERT INTO net_links (id, a_node_id, b_node_id, a_port, b_port, link_kind, speed_mbps, port_mode, native_vlan, confidence, last_verified_at, evidence_ref)
SELECT gen_random_uuid(),
  (SELECT id FROM net_nodes WHERE hostname='sw-aa144-a48'),
  (SELECT id FROM net_nodes WHERE hostname='swa-a161'),
  'Eth1/5','1/1/49','fiber',1000,'trunk',1,'confirmed_lldp',
  '2026-07-07T20:00:00Z'::timestamptz,'A48-lldp-2026-07-07.txt'
WHERE NOT EXISTS (
  SELECT 1 FROM net_links WHERE
    a_node_id=(SELECT id FROM net_nodes WHERE hostname='sw-aa144-a48') AND a_port='Eth1/5' AND
    b_node_id=(SELECT id FROM net_nodes WHERE hostname='swa-a161') AND b_port='1/1/49'
);

-- A48 Eth1/7 -> swa-aa144-access (25G)
INSERT INTO net_links (id, a_node_id, b_node_id, a_port, b_port, link_kind, speed_mbps, port_mode, native_vlan, confidence, last_verified_at, evidence_ref)
SELECT gen_random_uuid(),
  (SELECT id FROM net_nodes WHERE hostname='sw-aa144-a48'),
  (SELECT id FROM net_nodes WHERE hostname='swa-aa144-access'),
  'Eth1/7','1/1/51','fiber',25000,'trunk',1,'confirmed_lldp',
  '2026-07-07T20:00:00Z'::timestamptz,'A48-lldp-2026-07-07.txt'
WHERE NOT EXISTS (
  SELECT 1 FROM net_links WHERE
    a_node_id=(SELECT id FROM net_nodes WHERE hostname='sw-aa144-a48') AND a_port='Eth1/7' AND
    b_node_id=(SELECT id FROM net_nodes WHERE hostname='swa-aa144-access') AND b_port='1/1/51'
);

-- A48 Eth1/13 -> swa-h128 (Humanities, 1G)
INSERT INTO net_links (id, a_node_id, b_node_id, a_port, b_port, link_kind, speed_mbps, port_mode, confidence, last_verified_at, evidence_ref, notes)
SELECT gen_random_uuid(),
  (SELECT id FROM net_nodes WHERE hostname='sw-aa144-a48'),
  (SELECT id FROM net_nodes WHERE hostname='swa-h128'),
  'Eth1/13','1/1/49','fiber',1000,'trunk','confirmed_lldp',
  '2026-07-07T20:00:00Z'::timestamptz,'A48-lldp-2026-07-07.txt','LLDP shows VLAN ID 790 on neighbor advertisement'
WHERE NOT EXISTS (
  SELECT 1 FROM net_links WHERE
    a_node_id=(SELECT id FROM net_nodes WHERE hostname='sw-aa144-a48') AND a_port='Eth1/13' AND
    b_node_id=(SELECT id FROM net_nodes WHERE hostname='swa-h128') AND b_port='1/1/49'
);

-- A48 Eth1/14 -> CAH (Allied Health, 10G)
INSERT INTO net_links (id, a_node_id, b_node_id, a_port, b_port, link_kind, speed_mbps, port_mode, native_vlan, confidence, last_verified_at, evidence_ref)
SELECT gen_random_uuid(),
  (SELECT id FROM net_nodes WHERE hostname='sw-aa144-a48'),
  (SELECT id FROM net_nodes WHERE hostname='cah'),
  'Eth1/14','1/1/51','fiber',10000,'trunk',1,'confirmed_lldp',
  '2026-07-07T20:00:00Z'::timestamptz,'A48-lldp-2026-07-07.txt'
WHERE NOT EXISTS (
  SELECT 1 FROM net_links WHERE
    a_node_id=(SELECT id FROM net_nodes WHERE hostname='sw-aa144-a48') AND a_port='Eth1/14' AND
    b_node_id=(SELECT id FROM net_nodes WHERE hostname='cah') AND b_port='1/1/51'
);

-- A48 Eth1/25 -> sw-a144-1-aruba (10G)
INSERT INTO net_links (id, a_node_id, b_node_id, a_port, b_port, link_kind, speed_mbps, port_mode, native_vlan, confidence, last_verified_at, evidence_ref)
SELECT gen_random_uuid(),
  (SELECT id FROM net_nodes WHERE hostname='sw-aa144-a48'),
  (SELECT id FROM net_nodes WHERE hostname='sw-a144-1-aruba'),
  'Eth1/25','1/1/51','fiber',10000,'trunk',1,'confirmed_lldp',
  '2026-07-07T20:00:00Z'::timestamptz,'A48-lldp-2026-07-07.txt'
WHERE NOT EXISTS (
  SELECT 1 FROM net_links WHERE
    a_node_id=(SELECT id FROM net_nodes WHERE hostname='sw-aa144-a48') AND a_port='Eth1/25' AND
    b_node_id=(SELECT id FROM net_nodes WHERE hostname='sw-a144-1-aruba') AND b_port='1/1/51'
);

-- A48 Eth1/26 -> sw-a144-2-aruba (10G)
INSERT INTO net_links (id, a_node_id, b_node_id, a_port, b_port, link_kind, speed_mbps, port_mode, native_vlan, confidence, last_verified_at, evidence_ref)
SELECT gen_random_uuid(),
  (SELECT id FROM net_nodes WHERE hostname='sw-aa144-a48'),
  (SELECT id FROM net_nodes WHERE hostname='sw-a144-2-aruba'),
  'Eth1/26','1/1/51','fiber',10000,'trunk',1,'confirmed_lldp',
  '2026-07-07T20:00:00Z'::timestamptz,'A48-lldp-2026-07-07.txt'
WHERE NOT EXISTS (
  SELECT 1 FROM net_links WHERE
    a_node_id=(SELECT id FROM net_nodes WHERE hostname='sw-aa144-a48') AND a_port='Eth1/26' AND
    b_node_id=(SELECT id FROM net_nodes WHERE hostname='sw-a144-2-aruba') AND b_port='1/1/51'
);

-- A48 Eth1/28 -> swa-scc  ** CONFIRMED CORRECT SHARCC UPLINK ** (25G)
INSERT INTO net_links (id, a_node_id, b_node_id, a_port, b_port, link_kind, speed_mbps, port_mode, native_vlan, confidence, last_verified_at, evidence_ref, notes)
SELECT gen_random_uuid(),
  (SELECT id FROM net_nodes WHERE hostname='sw-aa144-a48'),
  (SELECT id FROM net_nodes WHERE hostname='swa-scc'),
  'Eth1/28','1/1/49','fiber',25000,'trunk',1,'confirmed_lldp',
  '2026-07-07T20:00:00Z'::timestamptz,'A48-lldp-2026-07-07.txt',
  'SharpCC uplink (confirmed correct). Carries OSPF VLAN624 (.49/.50) + user VLAN848'
WHERE NOT EXISTS (
  SELECT 1 FROM net_links WHERE
    a_node_id=(SELECT id FROM net_nodes WHERE hostname='sw-aa144-a48') AND a_port='Eth1/28' AND
    b_node_id=(SELECT id FROM net_nodes WHERE hostname='swa-scc') AND b_port='1/1/49'
);

-- A48 Eth1/37 -> swa-aa105 (25G)
INSERT INTO net_links (id, a_node_id, b_node_id, a_port, b_port, link_kind, speed_mbps, port_mode, native_vlan, confidence, last_verified_at, evidence_ref)
SELECT gen_random_uuid(),
  (SELECT id FROM net_nodes WHERE hostname='sw-aa144-a48'),
  (SELECT id FROM net_nodes WHERE hostname='swa-aa105'),
  'Eth1/37','1/1/51','fiber',25000,'trunk',1,'confirmed_lldp',
  '2026-07-07T20:00:00Z'::timestamptz,'A48-lldp-2026-07-07.txt'
WHERE NOT EXISTS (
  SELECT 1 FROM net_links WHERE
    a_node_id=(SELECT id FROM net_nodes WHERE hostname='sw-aa144-a48') AND a_port='Eth1/37' AND
    b_node_id=(SELECT id FROM net_nodes WHERE hostname='swa-aa105') AND b_port='1/1/51'
);

-- A48 Eth1/41 -> sw-aa148-aruba (25G)
INSERT INTO net_links (id, a_node_id, b_node_id, a_port, b_port, link_kind, speed_mbps, port_mode, native_vlan, confidence, last_verified_at, evidence_ref)
SELECT gen_random_uuid(),
  (SELECT id FROM net_nodes WHERE hostname='sw-aa144-a48'),
  (SELECT id FROM net_nodes WHERE hostname='sw-aa148-aruba'),
  'Eth1/41','1/1/25','fiber',25000,'trunk',1,'confirmed_lldp',
  '2026-07-07T20:00:00Z'::timestamptz,'A48-lldp-2026-07-07.txt'
WHERE NOT EXISTS (
  SELECT 1 FROM net_links WHERE
    a_node_id=(SELECT id FROM net_nodes WHERE hostname='sw-aa144-a48') AND a_port='Eth1/41' AND
    b_node_id=(SELECT id FROM net_nodes WHERE hostname='sw-aa148-aruba') AND b_port='1/1/25'
);

-- A48 Eth1/45 -> sw-e208 (1G)
INSERT INTO net_links (id, a_node_id, b_node_id, a_port, b_port, link_kind, speed_mbps, port_mode, native_vlan, confidence, last_verified_at, evidence_ref)
SELECT gen_random_uuid(),
  (SELECT id FROM net_nodes WHERE hostname='sw-aa144-a48'),
  (SELECT id FROM net_nodes WHERE hostname='sw-e208'),
  'Eth1/45','Gi1/0/1','fiber',1000,'trunk',1,'confirmed_lldp',
  '2026-07-07T20:00:00Z'::timestamptz,'A48-lldp-2026-07-07.txt'
WHERE NOT EXISTS (
  SELECT 1 FROM net_links WHERE
    a_node_id=(SELECT id FROM net_nodes WHERE hostname='sw-aa144-a48') AND a_port='Eth1/45' AND
    b_node_id=(SELECT id FROM net_nodes WHERE hostname='sw-e208') AND b_port='Gi1/0/1'
);

-- A48 Eth1/54 -> sw-t122-T48 (100G inter-core)
INSERT INTO net_links (id, a_node_id, b_node_id, a_port, b_port, link_kind, speed_mbps, port_mode, native_vlan, confidence, last_verified_at, evidence_ref, notes)
SELECT gen_random_uuid(),
  (SELECT id FROM net_nodes WHERE hostname='sw-aa144-a48'),
  (SELECT id FROM net_nodes WHERE hostname='sw-t122-T48'),
  'Eth1/54','Eth1/54','fiber',100000,'trunk',1,'confirmed_lldp',
  '2026-07-07T20:00:00Z'::timestamptz,'A48-lldp-2026-07-07.txt','AA144 A48 ↔ Tech T122 T48 inter-core interconnect'
WHERE NOT EXISTS (
  SELECT 1 FROM net_links WHERE
    a_node_id=(SELECT id FROM net_nodes WHERE hostname='sw-aa144-a48') AND a_port='Eth1/54' AND
    b_node_id=(SELECT id FROM net_nodes WHERE hostname='sw-t122-T48') AND b_port='Eth1/54'
);

-- A24 Eth1/8 -> sw-aa144-access (Cisco 3750, 1G)
INSERT INTO net_links (id, a_node_id, b_node_id, a_port, b_port, link_kind, speed_mbps, port_mode, native_vlan, confidence, last_verified_at, evidence_ref)
SELECT gen_random_uuid(),
  (SELECT id FROM net_nodes WHERE hostname='sw-aa144-a24'),
  (SELECT id FROM net_nodes WHERE hostname='sw-aa144-access'),
  'Eth1/8','Gi1/0/49','fiber',1000,'trunk',1,'confirmed_lldp',
  '2026-07-07T20:00:00Z'::timestamptz,'A24-lldp-2026-07-07.txt'
WHERE NOT EXISTS (
  SELECT 1 FROM net_links WHERE
    a_node_id=(SELECT id FROM net_nodes WHERE hostname='sw-aa144-a24') AND a_port='Eth1/8' AND
    b_node_id=(SELECT id FROM net_nodes WHERE hostname='sw-aa144-access') AND b_port='Gi1/0/49'
);

-- A24 Eth1/20 -> swa-slc151 (Dorms, 25G)
INSERT INTO net_links (id, a_node_id, b_node_id, a_port, b_port, link_kind, speed_mbps, port_mode, native_vlan, confidence, last_verified_at, evidence_ref)
SELECT gen_random_uuid(),
  (SELECT id FROM net_nodes WHERE hostname='sw-aa144-a24'),
  (SELECT id FROM net_nodes WHERE hostname='swa-slc151'),
  'Eth1/20','1/1/49','fiber',25000,'trunk',1,'confirmed_lldp',
  '2026-07-07T20:00:00Z'::timestamptz,'A24-lldp-2026-07-07.txt'
WHERE NOT EXISTS (
  SELECT 1 FROM net_links WHERE
    a_node_id=(SELECT id FROM net_nodes WHERE hostname='sw-aa144-a24') AND a_port='Eth1/20' AND
    b_node_id=(SELECT id FROM net_nodes WHERE hostname='swa-slc151') AND b_port='1/1/49'
);

-- A24 Eth1/30 -> swa-su121 (Student Union, 25G)
INSERT INTO net_links (id, a_node_id, b_node_id, a_port, b_port, link_kind, speed_mbps, port_mode, native_vlan, confidence, last_verified_at, evidence_ref)
SELECT gen_random_uuid(),
  (SELECT id FROM net_nodes WHERE hostname='sw-aa144-a24'),
  (SELECT id FROM net_nodes WHERE hostname='swa-su121'),
  'Eth1/30','1/1/51','fiber',25000,'trunk',1,'confirmed_lldp',
  '2026-07-07T20:00:00Z'::timestamptz,'A24-lldp-2026-07-07.txt'
WHERE NOT EXISTS (
  SELECT 1 FROM net_links WHERE
    a_node_id=(SELECT id FROM net_nodes WHERE hostname='sw-aa144-a24') AND a_port='Eth1/30' AND
    b_node_id=(SELECT id FROM net_nodes WHERE hostname='swa-su121') AND b_port='1/1/51'
);

-- A24 Eth1/35 -> sw-softballpb (1G)
INSERT INTO net_links (id, a_node_id, b_node_id, a_port, b_port, link_kind, speed_mbps, port_mode, native_vlan, confidence, last_verified_at, evidence_ref)
SELECT gen_random_uuid(),
  (SELECT id FROM net_nodes WHERE hostname='sw-aa144-a24'),
  (SELECT id FROM net_nodes WHERE hostname='sw-softballpb'),
  'Eth1/35','1/1/16','fiber',1000,'trunk',1,'confirmed_lldp',
  '2026-07-07T20:00:00Z'::timestamptz,'A24-lldp-2026-07-07.txt'
WHERE NOT EXISTS (
  SELECT 1 FROM net_links WHERE
    a_node_id=(SELECT id FROM net_nodes WHERE hostname='sw-aa144-a24') AND a_port='Eth1/35' AND
    b_node_id=(SELECT id FROM net_nodes WHERE hostname='sw-softballpb') AND b_port='1/1/16'
);

-- A24 Eth1/42 -> sw-sa208 (25G)
INSERT INTO net_links (id, a_node_id, b_node_id, a_port, b_port, link_kind, speed_mbps, port_mode, native_vlan, confidence, last_verified_at, evidence_ref)
SELECT gen_random_uuid(),
  (SELECT id FROM net_nodes WHERE hostname='sw-aa144-a24'),
  (SELECT id FROM net_nodes WHERE hostname='sw-sa208'),
  'Eth1/42','1/1/49','fiber',25000,'trunk',1,'confirmed_lldp',
  '2026-07-07T20:00:00Z'::timestamptz,'A24-lldp-2026-07-07.txt'
WHERE NOT EXISTS (
  SELECT 1 FROM net_links WHERE
    a_node_id=(SELECT id FROM net_nodes WHERE hostname='sw-aa144-a24') AND a_port='Eth1/42' AND
    b_node_id=(SELECT id FROM net_nodes WHERE hostname='sw-sa208') AND b_port='1/1/49'
);

-- A24 Eth1/44 -> sw-healthcenter (25G)
INSERT INTO net_links (id, a_node_id, b_node_id, a_port, b_port, link_kind, speed_mbps, port_mode, native_vlan, confidence, last_verified_at, evidence_ref)
SELECT gen_random_uuid(),
  (SELECT id FROM net_nodes WHERE hostname='sw-aa144-a24'),
  (SELECT id FROM net_nodes WHERE hostname='sw-healthcenter'),
  'Eth1/44','1/1/49','fiber',25000,'trunk',1,'confirmed_lldp',
  '2026-07-07T20:00:00Z'::timestamptz,'A24-lldp-2026-07-07.txt'
WHERE NOT EXISTS (
  SELECT 1 FROM net_links WHERE
    a_node_id=(SELECT id FROM net_nodes WHERE hostname='sw-aa144-a24') AND a_port='Eth1/44' AND
    b_node_id=(SELECT id FROM net_nodes WHERE hostname='sw-healthcenter') AND b_port='1/1/49'
);

-- A24 Eth1/26 -> swa-scc  ** STALE — this was during mispatch; correct uplink is A48 Eth1/28 **
INSERT INTO net_links (id, a_node_id, b_node_id, a_port, b_port, link_kind, speed_mbps, port_mode, native_vlan, confidence, last_verified_at, evidence_ref, notes)
SELECT gen_random_uuid(),
  (SELECT id FROM net_nodes WHERE hostname='sw-aa144-a24'),
  (SELECT id FROM net_nodes WHERE hostname='swa-scc'),
  'Eth1/26','1/1/49','fiber',25000,'trunk',1,'stale',
  '2026-07-07T19:20:00Z'::timestamptz,'A24-lldp-2026-07-07.txt',
  'STALE: true during mispatch. Current confirmed SharpCC uplink is A48 Eth1/28. Do not rely on this link.'
WHERE NOT EXISTS (
  SELECT 1 FROM net_links WHERE
    a_node_id=(SELECT id FROM net_nodes WHERE hostname='sw-aa144-a24') AND a_port='Eth1/26' AND
    b_node_id=(SELECT id FROM net_nodes WHERE hostname='swa-scc') AND b_port='1/1/49'
);


-- -------------------------
-- 3) OSPF ADJACENCIES
-- -------------------------
INSERT INTO net_routing_adjacencies
  (id, device_node_id, protocol, process, area, local_interface, local_ip,
   peer_router_id, peer_ip, state, last_seen_at, evidence_ref, notes)
VALUES

-- A48 -> SharpCC  (VLAN624, 172.20.2.49/.50)
(gen_random_uuid(),
 (SELECT id FROM net_nodes WHERE hostname='sw-aa144-a48'),
 'ospf','10','0.0.0.0','Vlan624','172.20.2.49',
 '10.80.48.1','172.20.2.50','FULL',
 '2026-07-07T20:05:00Z'::timestamptz,'A48-ospf-2026-07-07.txt','SharpCC OSPF adjacency'),

-- A48 -> V201  (VLAN619)
(gen_random_uuid(),
 (SELECT id FROM net_nodes WHERE hostname='sw-aa144-a48'),
 'ospf','10','0.0.0.0','Vlan619','172.20.2.30',
 '192.168.2.195','172.20.2.30','FULL',
 '2026-07-07T20:05:00Z'::timestamptz,'A48-ospf-2026-07-07.txt','V201 Agriculture OSPF adjacency')

ON CONFLICT DO NOTHING;


-- -------------------------
-- Verification
-- -------------------------
SELECT 'net_nodes' AS tbl, COUNT(*) AS rows FROM net_nodes
UNION ALL
SELECT 'net_links',        COUNT(*)          FROM net_links
UNION ALL
SELECT 'net_routing_adj',  COUNT(*)          FROM net_routing_adjacencies;
