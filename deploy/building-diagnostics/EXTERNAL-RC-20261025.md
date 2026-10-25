# External probe RC — 2026-10-25

This extends the earlier undeployed diagnostics candidate. Production Fred roles were revalidated: `sccc-api` is active in `/home/scccadmin/apps/Network-Insight-Hub`; SCCC Key runs separately from `/home/scccadmin/apps/SCCC-Key/current`. Private `10.0.0.22` retains central SNMP/LLDP/MAC and reporting duties. No live source, service, AD, certificate store or GPO was changed by RC preparation.

New behavior: selected quick 5 MiB checks; explicitly scheduled, confirmed, bounded sustained ranges from the 1 GiB object; DNS/TCP/TLS/HTTP/interface metrics; v2 authorization; persistent quotas/frequency; cancellation; and separate target configuration. Normal check-ins remain lightweight. Automatic existing Fred-path rotation does not create external jobs.

Windows canonical source and signed package are documented in `windows/SOURCE.md`; limits, exact operator steps, approval point and rollback are in `windows/EXTERNAL-PROBE-RC.md`. Configure `external-probe.env.example` only after review. Both reporting and sustained flags default off.

Verification: 42 backend tests passed, including 16 disposable PostgreSQL integration cases; 13 private-worker tests and three synthetic Chromium checks passed. Windows suites passed 51 existing plus 67 external assertions on 5.1 and 7; all executable RC payloads carry valid timestamped SCCC signatures. One signed-DLL 5 MiB check from the development host completed with HTTP 206/exact bytes. No sustained transfer, workstation installation or `.22` end-to-end pilot occurred. Linux API/frontend builds pass; existing broad workspace typecheck and frontend sourcemap/chunk-size issues remain outside this feature.

Signed helper ZIP SHA-256: `DE2626613DBF1B90898FF38DAD8999A6DB5D9C582E117F0886B774AB832788A3`. Public signer thumbprint: `9C6F10572711B7BD83AED649B405E239A9F345B0`. No certificate-store trust was added during preparation.

Versioned Linux staging: `/home/scccadmin/fred-external-probe-rc-20261025/build`. Do not run deployment from this path until the exact reviewed artifact/commits, publisher trust, named pilot and budget are approved. The earlier mutable `/home/scccadmin/fred-building-speed.u0Lthxfd/build/deploy/building-diagnostics/deploy-fred.sh` handoff is explicitly disabled because that directory had also been used for tests; the prior immutable `0faa141` bundle remains preserved.

After approval, the normal privileged command for the new versioned stage is:

```bash
sudo bash /home/scccadmin/fred-external-probe-rc-20261025/build/deploy/building-diagnostics/deploy-fred.sh /home/scccadmin/fred-external-probe-rc-20261025/build
```

It verifies the original live source hashes, backs up affected files/artifacts, keeps activation disarmed, restarts through normal service control and verifies health/anonymous denial. Check staged status in Fred afterward. Enable/reporting, private worker setup, verified publisher distribution and one named pilot require the explicit subsequent approval described in the operator plan. Fleet GPO remains off.
