# SCCC switch inventory (live status + addresses)

**Purpose:** Operational list of **buildings / devices**, **reachability status**, and **IP** (management **192.168.2.x** where noted, or **SVI**). Aligns with configs in this repo where filenames match site codes.

**Downlinks + OSPF + port mapping:** See **`BUILDING_SWITCH_TOPOLOGY.md`** (Nexus **a48/a24** ports, OSPF **Vlan611–628**, hostname ↔ file ↔ building).

**Source:** Provided by network operator (paste date: capture in git when updated).  
**Configs in repo:** `*.sccc.edu`, `fortigate-running.conf`, etc. — see **Likely config file** column (verify hostname inside file).

**Legend — Status**

| Value | Meaning |
|-------|---------|
| **Online** | Responding as expected |
| **Expected but Missing Live** | Should exist; not responding at inventory check |
| **Live but Not in Inventory** | Seen live; not labeled in asset inventory |

---

## Inventory table

| Building / device | Status | Address | Likely config file in repo (verify) |
|-------------------|--------|---------|--------------------------------------|
| Agriculture **V201** | Online | **192.168.2.195** | `swa-m201.sccc.edu` (confirm **V** vs **M** naming) |
| **Aruba 6300** A-144 **1** | Online | **192.168.2.201** | `sw-A144-1-aruba.sccc.edu` |
| **Aruba 6300** A-144 **2** | Online | **192.168.2.202** | `sw-A144-2-aruba.sccc.edu` |
| **B Building** (Boiler Room) | Expected but Missing Live | **192.168.2.196** | `Boiler_Aruba_Running.txt` (related); fix reachability |
| **Baseball Field** Pressbox | Online | **192.168.2.27** | — |
| **Cosmetology** | Online | **192.168.2.171** | `sw-cos109.sccc.edu` |
| **Epworth ALC** Building | Online | **192.168.2.24** | — (Epworth access; may be separate from aa144 core) |
| **FortiGate** Firewall (Hobble **AA-158**) | Online | **192.168.1.1** | `fortigate-running.conf` |
| **Hobble 6100** Access (**AA-144**) | Expected but Missing Live | **192.168.2.40** | `sw-aa144-access.sccc.edu` |
| Hobble **AA105** SVI | Online | **10.70.34.1** | `swa-aa105.sccc.edu` (SVI may be on stack) |
| **Hobble Building** (Server Room) | Online | **10.70.1.1** | Core/server VLAN — confirm device |
| **Hobble Core Access** (**AA-144**) | Online | **192.168.2.1** | Often **default gw** / core SVI context |
| **Hobble Core SVI** (**AA-144**) | Online | **10.80.33.1** | L3 SVI — pair with `sw-A144-*-aruba` / Nexus |
| Hobble **HR** AA105 | Online | **192.168.2.199** | — |
| Hobble **Testing A161** (**SWA-A161**) | Online | **192.168.2.197** | `swa-a161.sccc.edu` |
| **Humanities H128** | Online | **10.70.89.1** | `swa-h128.sccc.edu` |
| **Maintenance** | Online | **192.168.2.205** | — |
| **Missing Inventory Label** | Live but Not in Inventory | **10.40.14.246** | **Identify** and update CMDB |
| **Nexus Core 1** (Hobble **AA-158**) | Online | **192.168.2.70** | `sw-aa144-a48.sccc.edu` |
| **Nexus Core 2** (Hobble **AA-158**) | Online | **192.168.2.71** | `sw-aa144-a24.sccc.edu` |
| **Sharp Center** | Online | **192.168.2.203** | `swa-scc.sccc.edu` (Sharp Campus Center — confirm) |
| **SLG** Switch G | Online | **192.168.2.179** | `swa-slg.sccc.edu` |
| **Softball Field** | Online | **192.168.2.204** | `sw-softballPB.sccc.edu` |
| **Student Health Center** | Online | **192.168.2.212** | `sw-healthcenter-aruba.sccc.edu` |
| **Student Living Center** (**SLC151**) | Online | **192.168.2.175** | `swa-slc151.sccc.edu` |
| Student Living **SLS** | Online | **192.168.2.183** | `swa-sls.sccc.edu` |
| Student Living **SLT** | Online | **192.168.2.184** | `swa-slt.sccc.edu` |
| **Student Union** | Online | **192.168.2.200** | `sw-sa208.sccc.edu` or `swa-su121.sccc.edu` (confirm which mgmt) |
| Student Union **Gym 208** (SUGymCam) | Online | **192.168.252.46** | Camera / IoT subnet — may not be switch mgmt |
| **Tech B141** | Online | **192.168.2.186** | `swa-tb141.sccc.edu` |
| **Tech Building F** / Hale Court | Online | **192.168.2.178** | `swa-slf.sccc.edu` |
| **Tech Core 3** | Online | **192.168.2.72** | — (may be distribution; compare **Tech** campus Nexus) |
| **Tech Core 4** | Online | **192.168.2.73** | — |
| **Tech D201** | Online | **192.168.2.187** | `swa-td201.sccc.edu` |
| **Tech Dorm H** / Hale Court Building H | Online | **192.168.2.180** | `swa-slh.sccc.edu` |
| **Tech Dorm SLR** | Online | **192.168.2.182** | `swa-slr.sccc.edu` |
| **Tech Dorms J** (**SLJ**) | Online | **192.168.2.181** | `swa-slj.sccc.edu` |
| **Tech T122** (mgmt) | Online | **192.168.2.190** | `swa-t122.sccc.edu`; also `sw-t122-a48.sccc.edu`, `sw-t122-a24.sccc.edu` |
| **Tech T122** (SVI) | Expected but Missing Live | **10.30.16.1** | SVI down or VLAN not up — investigate |
| **Tech TA107** | Online | **192.168.2.189** | `swa-ta107.sccc.edu` |
| **Tech TT103** | Online | **192.168.2.188** | `swa-tt103.sccc.edu` |

---

## Evidence cross-check (configs already in repo)

| Address | Role | Config evidence |
|---------|------|-----------------|
| **192.168.2.70** | Nexus **a48** | `interface Vlan1` … `ip address 192.168.2.70/16` in **`sw-aa144-a48.sccc.edu`** |
| **192.168.2.71** | Nexus **a24** | `interface Vlan1` … `192.168.2.71/16` in **`sw-aa144-a24.sccc.edu`** |

---

## Action items (from Status column)

1. **Expected but Missing Live:** **192.168.2.40** (Hobble 6100 Access), **192.168.2.196** (B Boiler), **10.30.16.1** (T122 SVI) — ping/trace, stack power, VLAN SVI `no shutdown`.
2. **Missing Inventory Label:** **10.40.14.246** — identify device, add to CMDB, update description on port.
3. **Agriculture V201** vs **`swa-m201`:** confirm naming (**M** vs **V** building); rename file or row for consistency.

---

## Related docs

- **`SCCC_NETWORK_OVERVIEW_ALL_BUILDINGS.md`** — campus map, VLAN roles, OSPF **/30** table.
- **`NETWORK_OVERVIEW.md`** — FortiGate, Azure, full VLAN name list on aa144.
