# Building ↔ downlinks ↔ OSPF ↔ switch inventory ↔ config files

**Purpose:** Single matrix for **Nexus distribution** (**sw-aa144-a48** / **sw-aa144-a24**), **building-facing ports**, **OSPF routed links**, **live IP inventory**, and **`*.sccc.edu`** paths in **`c:\Code\Aruba`**.

**Evidence:** Interface / VLAN descriptions from saved configs; mgmt/SVI IPs from **`SWITCH_INVENTORY.md`**; LLDP lines from **`sw-aa144-a24.sccc.edu`** where present.

---

## 1. OSPF point-to-point SVIs — `sw-aa144-a48` (distribution)

These are **/30 transit** links (not user LAN subnets). **OSPF** process **10** or **100** per SVI config.

| VLAN | Description | Local IP (a48) | Remote site / building (from name) | Notes |
|------|-------------|----------------|-------------------------------------|--------|
| **611** | OSPF-TO-6509-CORESWITCH | **172.20.2.1/30** | Core **6509** | Upstream core |
| **612** | OSPF-TO-9300NEXUS-BuilingT | **172.20.3.1/30** | **Industrial Tech** Nexus (**Building T**) | Typo “Builing” in config |
| **613** | OSPF-H128-CiscoA48 | **172.20.2.5/30** | **Humanities H128** | Pairs with **`swa-h128`** |
| **614** | OSPF10-AA144-A48Cisco9k | **172.20.2.9/30** | **AA144** plane to **9k** | Inter-plane |
| **615** | OSPF10-A48Cisco9k-TO-T48Cisco9k | **172.20.2.13/30** | **a48 ↔ T48** (Tech **T122** stack) | See **`sw-t122-a48`** |
| **616** | OSPF10-Epworth-To-Cisco9k-A48 | **172.20.2.17/30** | **Epworth** | Remote |
| **617** | OSFP10-TechSchool-To-A48Cisco9k | **172.20.2.21/30** | **Tech school** | Industrial campus |
| **618** | OSFP10-SLC151-Dorms-To-A48Cisco9k | **172.20.2.25/30** | **SLC151** dorms | Pairs **`swa-slc151`** |
| **619** | OSPF10-V201 | **172.20.2.29/30** | **Agriculture V201** | LLDP name **SWA-V201** on **a24** downlink |
| **620** | OSPF10-B101 | **172.20.2.33/30** | **Tech B101** | **`sw-b101`** |
| **621** | OSPF10-TA107 | **172.20.2.37/30** | **Tech TA107** | **`swa-ta107`** |
| **622** | OSPF10-A144-1 | **172.20.2.41/30** | **Hobble A144 stack 1** | **`SW-A144-1-Aruba`** |
| **623** | OSPF10-A144-2 | **172.20.2.45/30** | **Hobble A144 stack 2** | **`SW-A144-2-Aruba`** |
| **624** | OSPF10-SharpCC | **172.20.2.49/30** | **Sharp Champion Center** | **`swa-scc`** |
| **625** | OSPF10-AA105 | **172.20.2.53/30** | **Hobble AA105** | **`SWA-AA105`** |
| **626** | OSPF-SU121 | **172.20.2.57/30** | **Student Union SU121** | **`SWA-SU121`** |
| **627** | OSPF-COS109 | **172.20.2.61/30** | **Cosmetology COS109** | **`SW-COS109`** |
| **628** | OSPF-Healthcenter | **172.20.2.65/30** | **Student Health Center** | **`sw-healthcenter`** |

---

## 2. Layer-2 downlinks — `sw-aa144-a48` (Ethernet)

| Port | Description | Building / role | Likely remote hostname | Config file (repo) | Inventory IP (see **`SWITCH_INVENTORY.md`**) |
|------|-------------|-----------------|-------------------------|--------------------|---------------------------------------------|
| **E1/7** | Connectivity to **SW-AA144Core-USD480** | Hobble core path | `SW-AA144-Core-USD480` | **`sw-aa144.sccc.edu`** | — |
| **E1/11** | **SW-H128-TEST** | Humanities test | — | — | — |
| **E1/12** | **SW-H128-PRIM** | **Humanities H128** | `swa-h128` | **`swa-h128.sccc.edu`** | **10.70.89.1** (SVI) |
| **E1/14** | **SW-CAH144** | **Calvin Allied Health** | — (CAH stack) | — (no `sw-cah*.sccc.edu` in repo) | — |
| **E1/15** | **AA109-PaloAlto-Link** | Hobble / Annex security | Palo Alto | — | — |
| **E1/21** | **AA148** Aruba 6100 uplink | Annex / remote office | `swa-aa148` | **`swa-aa148.sccc.edu`** | — |
| **E1/25** | **A144** Aruba stack **1** | **Hobble** access | `SW-A144-1-Aruba` | **`sw-A144-1-aruba.sccc.edu`** | **192.168.2.201** |
| **E1/26** | **A144** Aruba stack **2** | **Hobble** access | `SW-A144-2-Aruba` | **`sw-A144-2-aruba.sccc.edu`** | **192.168.2.202** |
| **E1/27** | **SWA-AA144.Access** | Hobble 6100 access | `SW-AA144-Access` | **`sw-aa144-access.sccc.edu`** | **192.168.2.40** (Missing Live) |
| **E1/28** | **SharpCC** to AA144 | **Sharp Center** | `swa-scc` | **`swa-scc.sccc.edu`** | **192.168.2.203** |
| **E1/35–36** | **FortiGate1/2** Port35 IDEATEK | Edge | FortiGate | **`fortigate-running.conf`** | **192.168.1.1** |
| **E1/40** | **B101** to AA144 | **Tech B101** | `SW-B101` | **`sw-b101.sccc.edu`** | — (see **B141** / B stack in inventory) |
| **E1/43–44** | **Aruba 7205** Controller 1/2 | WLAN control | — | — | — |
| **E1/49** | **peerlink** to 24-port Nexus | **VPC** to **a24** | `sw-aa144-A24` | **`sw-aa144-a24.sccc.edu`** | **192.168.2.71** |
| **E1/54** | Link **AA144 A48** and **T122 T48** | **Tech T122** / **T48** | `sw-t122-T48` | **`sw-t122-a48.sccc.edu`** | **192.168.2.72** / **.73** (pair with **a24**) |

---

## 3. Layer-2 downlinks — `sw-aa144-a24` (Ethernet)

| Port | Description | Building / role | Likely remote hostname | Config file (repo) | Inventory IP |
|------|-------------|-----------------|-------------------------|--------------------|--------------|
| **E1/7** | **SW-A163-Aruba-TestingCenter** | Testing **A161/A163** | — | **`swa-a161.sccc.edu`** | **192.168.2.197** |
| **E1/8** | **SW-AA144-access** 49 | Hobble access | `SW-AA144-Access` | **`sw-aa144-access.sccc.edu`** | **192.168.2.40** |
| **E1/9** | **SW-COS109-PRIM** | **Cosmetology** | `SW-COS109` | **`sw-cos109.sccc.edu`** | **192.168.2.171** |
| **E1/20** | **SLC1151** to AA144 9k | **SLC151** area | `SWA-SLC151` | **`swa-slc151.sccc.edu`** | **192.168.2.175** |
| **E1/22** | **COS109** to AA144 port 22 | **Cosmetology** | `SW-COS109` | **`sw-cos109.sccc.edu`** | **192.168.2.171** |
| **E1/24** | **SharpChampionCenter** | **Sharp Center** | `swa-scc` | **`swa-scc.sccc.edu`** | **192.168.2.203** |
| **E1/26** | **SW-AA144-A24** To **SWA-V201** | **Agriculture V201** | **SWA-V201** (LLDP) | **`swa-m201.sccc.edu`** — **hostname inside file is `swa-m201`**; **verify** vs **SWA-V201** | **192.168.2.195** |
| **E1/27** | **SW-AA144-A24** TO **SWA-AA105** | **Hobble AA105** | `SWA-AA105` | **`swa-aa105.sccc.edu`** | **10.70.34.1** (SVI) / **192.168.2.199** |
| **E1/30** | **SU121** to AA144 9k | **Student Union** | `SWA-SU121` | **`swa-su121.sccc.edu`** | **192.168.2.200** |
| **E1/32** | **B101** to AA144 | **Tech B101** | `SW-B101` | **`sw-b101.sccc.edu`** | — |
| **E1/35** | **SW-SoftballPB-Aruba** | **Softball** | `SW-SoftBallPB` | **`sw-softballPB.sccc.edu`** | **192.168.2.204** |
| **E1/36** | **FortiGate2** Port36 United ISP | Edge | FortiGate | **`fortigate-running.conf`** | **192.168.1.1** |
| **E1/40** | **E208** to AA144-A24 | Union / gym wiring | — | — | **192.168.252.46** (cam) |
| **E1/42** | **SA208** to AA144-A24 | **Student Union SA208** | `sw-sa208` | **`sw-sa208.sccc.edu`** | — |
| **E1/43** | **HealthCenter** to AA144-A24 | **Student Health Center** | `sw-healthcenter` | **`sw-healthcenter-aruba.sccc.edu`** | **192.168.2.212** |
| **E1/45** | **SWA-AA148** 6100 Cecil's Office | **AA148** | `swa-aa148` | **`swa-aa148.sccc.edu`** | — |
| **E1/49** | **SW-AA144-A24** CONNECTION TO **SW-AA144-A48** | **VPC / peer** | `sw-aa144-A48` | **`sw-aa144-a48.sccc.edu`** | **192.168.2.70** |

---

## 4. All switches in repo — hostname ↔ file ↔ building (from inventory)

| Hostname (from `hostname` line) | Config file | Building / notes (inventory) | Address |
|---------------------------------|-------------|------------------------------|---------|
| `sw-aa144-A48` | `sw-aa144-a48.sccc.edu` | Nexus Core 1 Hobble | **192.168.2.70** |
| `sw-aa144-A24` | `sw-aa144-a24.sccc.edu` | Nexus Core 2 Hobble | **192.168.2.71** |
| `SW-AA144-Core-USD480` | `sw-aa144.sccc.edu` | Hobble core USD480 | — |
| `SW-A144-1-Aruba` | `sw-A144-1-aruba.sccc.edu` | Hobble stack 1 | **192.168.2.201** |
| `SW-A144-2-Aruba` | `sw-A144-2-aruba.sccc.edu` | Hobble stack 2 | **192.168.2.202** |
| `SW-AA144-Access` | `sw-aa144-access.sccc.edu` | Hobble 6100 Access | **192.168.2.40** |
| `swa-h128` | `swa-h128.sccc.edu` | Humanities H128 | **10.70.89.1** |
| `SW-COS109` | `sw-cos109.sccc.edu` | Cosmetology | **192.168.2.171** |
| `SW-B101` | `sw-b101.sccc.edu` | Tech B101 | — |
| `swa-scc` | `swa-scc.sccc.edu` | Sharp Center | **192.168.2.203** |
| `SWA-SU121` | `swa-su121.sccc.edu` | Student Union SU121 | **192.168.2.200** |
| `sw-sa208` | `sw-sa208.sccc.edu` | Student Union SA208 | — |
| `SWA-SLC151` | `swa-slc151.sccc.edu` | SLC151 | **192.168.2.175** |
| `SWA-SLJ` | `swa-slj.sccc.edu` | Tech dorm SLJ | **192.168.2.181** |
| `SWA-SLH` | `swa-slh.sccc.edu` | Tech dorm H | **192.168.2.180** |
| `SWA-SLR` | `swa-slr.sccc.edu` | Tech dorm SLR | **192.168.2.182** |
| `SWA-SLS` | `swa-sls.sccc.edu` | Student Living SLS | **192.168.2.183** |
| `SWA-SLT` | `swa-slt.sccc.edu` | Student Living SLT | **192.168.2.184** |
| `SWA-SLG` | `swa-slg.sccc.edu` | SLG Switch G | **192.168.2.179** |
| `SWA-SLF` | `swa-slf.sccc.edu` | Tech Building F | **192.168.2.178** |
| `swa-t122` | `swa-t122.sccc.edu` | Tech T122 mgmt | **192.168.2.190** |
| `sw-t122-T48` | `sw-t122-a48.sccc.edu` | Tech T122 / T48 plane | **192.168.2.72** (pair **.73**) |
| `sw-t122-T24` | `sw-t122-a24.sccc.edu` | Tech T122 / T24 plane | **192.168.2.73** |
| `swa-ta107` | `swa-ta107.sccc.edu` | Tech TA107 | **192.168.2.189** |
| `swa-tt103` | `swa-tt103.sccc.edu` | Tech TT103 | **192.168.2.188** |
| `swa-tb141` | `swa-tb141.sccc.edu` | Tech B141 | **192.168.2.186** |
| `swa-td201` | `swa-td201.sccc.edu` | Tech D201 | **192.168.2.187** |
| `swa-aa148` | `swa-aa148.sccc.edu` | AA148 6100 | — |
| `SWA-AA105` | `swa-aa105.sccc.edu` | Hobble AA105 | **10.70.34.1** / **192.168.2.199** |
| `swa-a161` | `swa-a161.sccc.edu` | Testing A161 | **192.168.2.197** |
| `swa-m201` | `swa-m201.sccc.edu` | Inventory **Agriculture V201** — **LLDP** on a24 shows **SWA-V201** | **192.168.2.195** |
| `SW-SoftBallPB` | `sw-softballPB.sccc.edu` | Softball | **192.168.2.204** |
| `sw-healthcenter` | `sw-healthcenter-aruba.sccc.edu` | Student Health | **192.168.2.212** |
| `SWA-SLAB` | `swa-slcab.sccc.edu` | SLC **AB** zone (confirm vs map) | — |
| `SWA-SLCDE` | `sw-slccde.sccc.edu` | SLCC DE (confirm) | — |
| `SW-TB156` / **152** / **140** | `sw-tb156.sccc.edu` etc. | Extra Tech IDs (not in inventory paste) | — |
| `SW-AA001` | `sw-aa001.sccc.edu` | — | — |

**Not represented as `*.sccc.edu` in repo:** **Epworth** (**192.168.2.24**), **Baseball** (**192.168.2.27**), **Maintenance** (**192.168.2.205**), **Boiler** (`Boiler_Aruba_Running.txt` only).

---

## 5. Naming items to verify

| Topic | Detail |
|-------|--------|
| **SWA-V201** vs **`swa-m201`** | **a24** LLDP / port **E1/26** description points to **SWA-V201**; repo file **`swa-m201.sccc.edu`** uses **`hostname swa-m201`**. Reconcile hostname vs **V201** building label. |
| **Tech Core 3 / 4** | Inventory **192.168.2.72** / **.73** — aligned to **`sw-t122-a48`** / **`sw-t122-a24`** Nexus pair; confirm asset names in DCIM. |
| **Hobble Core Access 192.168.2.1** | May be **SVI** or **HSRP** — not necessarily a physical switch file in this folder. |

---

## Related

- **`SWITCH_INVENTORY.md`** — live status column.  
- **`SCCC_NETWORK_OVERVIEW_ALL_BUILDINGS.md`** — §2 voice/OSPF summary (this file supersedes for **port-level** detail).  
- Regenerate after any **`show run`** export from **a48/a24**.
