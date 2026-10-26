# 2026-10-25 building diagnostics implementation

Request: every managed AD computer reports presence and network identity, with automatic rotating performance samples per building, manual computer selection, and private `10.0.0.22` report pulling through public Fred.

Implemented:

- Dedicated Fred persistence/API, full AD roster including computers without an installed helper, fresh switch/AP evidence and clearly labeled assigned-office fallback, unknown/conflict handling, and existing Fred building catalog coverage.
- Bounded single-lease scheduler, per-building fair rotation, manual selection, exact transfer receipts, device-bound HMAC jobs, and honest missing measurements.
- Independent provisioned credentials, revocation/rotation, audit records, and AD export freshness separate from upload freshness.
- SSO-authorized Building Speed & Computers page, selected/random building samples, and role-restricted inventory.
- Private HTTPS pull worker, atomic replay-safe result files, individual MAC/access-port adapter, exact identity-to-phone mapping, and AD/Kerberos pilot provisioning.
- Separate protected Windows helper, disabled task staging, signed activation requirements, and rollback instructions. Existing alert receiver/MFA/GPO files were not modified.

Verification completed:

- 33 backend tests passed in Linux, including 11 real PostgreSQL integration cases against a new loopback-only disposable cluster. That cluster was stopped afterward; no production database was used.
- 13 Python worker tests passed.
- 50 Windows helper offline assertions passed under Windows PowerShell 5.1 and PowerShell 7; no task activation or real transfer was performed.
- Two synthetic Chromium UI tests passed for building sample selection, missing measurements, and unauthorized access. Fixture calls never reach production APIs.
- Linux API and frontend production builds passed. Existing frontend sourcemap/chunk-size warnings remain. The repository excludes Windows native build binaries, so Linux is the matching build environment. Broad workspace typechecking has pre-existing errors; it is not represented as a clean gate.
- Deployment script shell syntax and affected live source hashes checked. A guarded backup/deploy script is supplied; it refuses intervening source changes and does not activate reporting or GPO.

Delivery status: source implemented and deployment staged. Production deployment, signed helper activation, current `.22` inventory feeds, and end-to-end named-workstation pilot remain pending. The SSH deployment account currently requires a sudo password, and `10.0.0.22:22` was unreachable from this workstation. No fleet GPO, scheduler, campus speed load, switch setting, alert, or MFA change was activated.

Source reconciliation: live Fred source was imported into an isolated branch as a separate baseline commit. Another thread's checkout and changes were preserved. Feature changes must be reviewed/applied independently of that baseline reconciliation.

## Device Performance control release — later 2026-10-25 handoff

The earlier staging status above is historical. Current design, verification checkpoints and pilot/activation boundaries are recorded in [DEVICE-PERFORMANCE-20261025.md](DEVICE-PERFORMANCE-20261025.md).

- Added the SSO-first workbench/native entry, canonical callback routing and verified AD GUID preselection.
- Added CIO-persisted scheduler arming/revision fences, queue audit, readiness and restricted worker presence projection.
- Added the separate hourly AD publisher, atomic AD-only exchange, private bounded SNMP/controller correlation, protected report/presence state, Influx export and Grafana dashboard generation.
- Added trusted controller client-MAC location support for SYSTEM sessions without BSSID permission; applied only the two reviewed backend files/API build after fresh live hash guards and backup.
- Named helper/CIO SSO pilot verified; private collector/controller follow-up first cycle, publisher UAC and end-to-end reporting remain separate acceptance steps. Scheduler/sustained gates and fleet rollout remain off.
- First private cycle subsequently delivered 675 presence points and two reports, with SNMP coverage explicitly degraded. Read-only SW-BB proof led to a tested bounded FDB-bulk follow-up; its successful candidate still yielded no eligible edge ports, so no access policy was relaxed.

## Frozen prototype; retained Building Probe migration

This branch records the divergent prototype for recovery and review. It is not the final selected-computer scheduler. Do not activate its scheduler, expand its pilot, or deploy it over the retained Building Probe implementation.

The agreed implementation extends the existing `SCCCBuildingProbe` service and ES256 `/api/building-probes` contract from the reviewed building-probe worktrees. Recurring selection remains separate from security enrollment and revocation. Only LP-AA152MB-01 and LP-F6K6S64 are in scope for the initial migration pilot. Existing alert, personal MFA, and wireless telemetry boundaries remain unchanged.

The 20:37 UTC prototype snapshot attributed LP-F6K6S64 through T122 port `1/1/49`. A later bounded LLDP read verified that port is a Cisco Nexus uplink; that attribution is invalid. Do not promote it to canonical building membership or replay it as verified location evidence. The private diagnostics timer remains disabled. Retire the prototype only after the retained path has been verified and a controlled migration is reviewed.
