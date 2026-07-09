-- VLAN Building Correction Script
-- Problem: auto-importer tagged all VLANs with the source switch's building
-- instead of the building the VLAN actually serves.
-- Run on appserver: psql "postgres://sccc:a-strong-password@localhost:5432/sccc_it" -f fix_vlan_buildings.sql

BEGIN;

-- ============================================================
-- HOBBLE (A-building: A144, A149, A163, A166, A192 rooms)
-- ============================================================
UPDATE vlans SET building = 'Hobble'
WHERE vlan_id IN (680, 701, 702, 703, 706, 707, 708, 714);
-- 680  A001              10.80.8.x
-- 701  a144-staff        10.70.1.x
-- 702  a163-tesingcenter 10.70.2.x
-- 703  Unknown_703       A136 AACII Lab
-- 706  a149              A149 SSC Lab
-- 707  a153              A166A Math Lab
-- 708  a166              A166 Library Lab
-- 714  a192              A192 Math Lab

-- ============================================================
-- ACADEMIC ARTS (AA-building rooms mis-tagged as "Academic Arts 144")
-- ============================================================
UPDATE vlans SET building = 'Academic Arts'
WHERE vlan_id IN (726, 728, 729, 730, 731, 733);
-- 726  Unknown_726  AA131 Crusader lab
-- 728  aa137        AA137 Virtual Learning Center Lab
-- 729  aa155        AA155 Biology Lab
-- 730  aa159        AA159 Maintenance/Part-time
-- 731  aa163        AA163 Biology/Chemistry Lab
-- 733  aa105-staff-wireless
-- NOTE: 734 AA101, 735 AA109, 736 AA112, 737 AA113 already "Academic Arts" (correct)

-- ============================================================
-- HUMANITIES (H-building, H128)
-- ============================================================
UPDATE vlans SET building = 'Humanities'
WHERE vlan_id IN (304, 788, 789, 790);
-- 304  VOIP-H          VOIP in H128
-- 788  H109-HumLab     Humanities lab
-- 789  HumanitiesBuilding  H128 data VLAN
-- 790  HumanitiesTest

-- ============================================================
-- COSMETOLOGY (COS-building, COS109)
-- ============================================================
UPDATE vlans SET building = 'Cosmetology'
WHERE vlan_id IN (305, 749, 750);
-- 305  VOIP-COS    VOIP in COS109
-- 749  CosmoBuilding
-- 750  ArubaAP-COS

-- ============================================================
-- STUDENT LIVING CENTER (SLC / SLCAB / SLCCDE / SLCT etc.)
-- ============================================================
UPDATE vlans SET building = 'Student Living Center'
WHERE vlan_id IN (200, 307, 308, 309, 321, 351, 375, 824, 826, 833);
-- 200  slc-guest-aruba
-- 307  VOIP-SLC     VOIP in SLC151
-- 308  VLAN308      VOIP in SLCCDE
-- 309  VOIP-SLCAB   VOIP in SLCAB
-- 321  VOIP-SLCT    VOIP in SLCT
-- 351  PSEC-SLC     Cameras in SLC/SLCAB/SLCCDE/SLCF/SLCG/SLCH/SLCJ/SLCR/SLCS/SLCT
-- 375  sc-iot       DAC-SLC
-- 824  SLC-Buildings  SLC Dorm Office and Lab
-- 826  ArubaAP-SLC  Aruba AP in SLC
-- 833  StudentBuilding

-- ============================================================
-- CORE / DATA CENTER (server room, SAN, iSCSI, Nutanix, VMware)
-- ============================================================
UPDATE vlans SET building = 'Core'
WHERE vlan_id IN (2, 400, 401, 403, 404, 410, 411, 414, 415, 416, 610, 614, 615, 660);
-- 2    san00/SAN00         SAN storage
-- 400  VLAN400             Main Server VLAN
-- 401  main_server_vlan
-- 403  Citrix              HP equipment
-- 404  3CXPBX              VMotion/PBX
-- 410  HPiSCSI-410         iSCSI vlan1
-- 411  VLAN411             iSCSI vlan2
-- 414  Nutanix-IPMI
-- 415  Nutan-VMWareVmotion
-- 416  Nutanix-VMMgmtCVMClst
-- 610  it-staff            IT staff VLAN
-- 614  OSPF10-AA144-A48    OSPF infrastructure link
-- 615  OSPF10-T48-A48      OSPF infrastructure link
-- 660  VDI-Desktops

-- ============================================================
-- CAMPUS-WIDE (multi-building or wireless campus infrastructure)
-- ============================================================
UPDATE vlans SET building = 'Campus-wide'
WHERE vlan_id IN (
    10,   -- videovlan10
    120,  -- VLAN120
    300,  -- VLAN0300
    332,  -- TestingAndGI (off-campus phones)
    349,  -- PSEC-A-AA (cameras in A+AA)
    350,  -- PSEC-S-B-H-Cos-V-M (multi-building cameras)
    353,  -- PSEC-C-E-EAnnex-CAH (multi-building cameras)
    373,  -- DAC-A-AA (multi-building)
    377,  -- DAC-C-E-Eannex-CAH (multi-building)
    402,  -- printers
    405,  -- digitalsignage
    500,  -- Wireless1
    501,  -- Wireless2
    502,  -- WLAN-APs-WCS
    504,  -- WLAN-Private
    506,  -- WLAN-IPads
    508,  -- WLAN-Public
    564,  -- HDMI/Projectors (campus-wide)
    568,  -- HDMI (from swa-aa148)
    601,  -- LAN2
    670,  -- P2P-AA109-AA144
    723,  -- arubaap-outdoor (outdoor APs)
    722,  -- arubaap-a (A and AA buildings)
    997,  -- TempVoiceVlan997
    998   -- TempVoiceVlan998
);

-- ============================================================
-- TECH BUILDINGS (T, TA, TB, TD, TT cluster)
-- 316,317 → swa-ta107 | 319 → swa-td201 | 320 → swa-tt103 (already done)
-- Remaining tech VLANs → swa-ta107 as primary campus tech building
-- ============================================================
UPDATE vlans SET building = 'swa-ta107'
WHERE vlan_id IN (352, 801, 802, 803, 806, 809);
-- 352  VLAN352 (cameras in T,TA,TB,TD,TT)
-- 801  TechSchool-Data
-- 802  TechSchoolLabs
-- 803  TechHVAC
-- 806  ArubaAP-T
-- 809  T-WorkForceCenter

-- ============================================================
-- ??? UNKNOWN BUILDING NAMES - FILL IN BEFORE RUNNING
-- ============================================================

-- Building B (B101) - what is the building called?
UPDATE vlans SET building = 'Tech-B' WHERE vlan_id IN (310);  -- VOIP-B

-- Building M (M201) - what is the building called?
-- UPDATE vlans SET building = 'M-building-name' WHERE vlan_id IN (311);  -- VOIP-M

-- Building C (C105) - what is the building called? (NOT Cosmetology)
-- UPDATE vlans SET building = 'C-building-name' WHERE vlan_id IN (312);  -- VOIP-C

-- Building E (E208) and E-Annex
-- UPDATE vlans SET building = 'E-building-name' WHERE vlan_id IN (313, 314, 774, 775);

-- Building V (V201, V103 AgLab) / Agriculture
UPDATE vlans SET building = 'Agriculture' WHERE vlan_id IN (306, 764, 765, 766);

-- CAH (Center for Allied Health, CAH144)
UPDATE vlans SET building = 'Allied Health' WHERE vlan_id IN (322, 840, 841, 842, 845);

-- SA-building (Student Activities / Student Affairs?)
UPDATE vlans SET building = 'Student Activities' WHERE vlan_id IN (821);

-- Athletics / Gymnasium / Sharp Champions Center
UPDATE vlans SET building = 'Sharp Champion Center' WHERE vlan_id IN (820, 832, 848, 999);

-- Maintenance building
-- UPDATE vlans SET building = 'Maintenance' WHERE vlan_id IN (816, 819);

-- Verify
SELECT building, count(*) FROM vlans GROUP BY building ORDER BY building;

COMMIT;   -- ← Change to COMMIT once ??? lines above are filled in and uncommented
