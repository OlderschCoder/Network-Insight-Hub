# External network probe release candidate

This is a separate managed Windows capability within SCCC Key & Alert. It does not change the alert receiver, MFA storage, consumer installers, Store packages, or normal alert check-ins. No SNMP credential, worker token, alert authority, or private `10.0.0.22` access is given to the helper.

## Configuration and limits

The public Fred origin remains the reporting/control destination. The external target is independently configured in a protected per-device record as `externalProbeOrigin`, matching Fred's `BUILDING_DIAGNOSTICS_EXTERNAL_ORIGIN`. Neither defaults to an active probe hostname. The sample uses the temporary `https://markb855.sg-host.com` host; `it.sccc.edu/probe` is not active. A replacement origin must publish the same fixed binary paths or receive a separately reviewed path-prefix update.

- Quick: fixed `/probe-5mb.bin`, exactly 5,242,880 bytes, at most 30 seconds. Named computers/on-demand selection only. At least 15 minutes between external probes on a device.
- Sustained: fixed `/probe-1gb.bin`, 1,073,741,824-byte source object, requested by a bounded byte range. Default 64 MiB; maximum 1 GiB and 180 seconds. Requires one explicitly selected computer, future scheduled time, data-use confirmation, Fred's sustained flag, and that device's protected `permitSustained:true`. At least 24 hours between sustained probes on a device.
- Default global external data reservation is 1 GiB per rolling 24 hours; all external and Fred-path tests share one persisted execution slot. Cancellation retains that slot until the helper closes/acknowledges or the lease expires. Failed/cancelled work still counts conservatively toward frequency/data limits.

No external transfer occurs during a routine check-in. A helper advertises external capability only when its protected origin is configured. Each operation requires a short-lived device-bound v2 HMAC job. Old v1 Fred-path jobs remain compatible. External jobs accept no arbitrary command, upload, user file, redirect, URL path, or private IP destination.

The compiled engine resolves DNS, rejects nonpublic/special addresses, pins the connection to a checked address, and validates TLS/SNI with normal Windows trust. It sends no Fred bearer, cookies, or user content to SiteGround. It uses direct HTTPS rather than authenticated proxy credentials; proxy-only environments report failure. DLL code is compiled during packaging and Authenticode signed; production does not compile an unsigned `.cs` file.

Results include DNS answers/timing, TCP and TLS timing, first-byte timing, HTTP status, bytes/elapsed time/calculated Mbps, failure/timeout/cancellation, timestamp, and actual socket/interface metadata: local IP/prefix, gateway, adapter and available SSID/BSSID. Results go to public Fred HTTPS; private `.22` pulls the reports and retains SNMP/LLDP/MAC correlation and its existing reporting pipeline.

This measures end-to-end external HTTPS throughput. Hosting/CDN, endpoint hardware, Wi-Fi and the path can limit it. It does not certify a 10 Gb link; retain LinkRunner, suitable parallel-stream iperf3, or RFC 2544 testing for authoritative high-speed path validation. The binary responses have no-cache headers. The current upstream health JSON permits long caching, so do not interpret its body as a fresh-origin timestamp.

## Reproduce and verify the signed candidate

Commit reviewed source first. Use the existing SCCC Artifact Signing profile metadata; no private key is exported:

```powershell
.\windows\build-diagnostics.ps1 -ReleaseVersion 1.1.0-rc1 -SigningMetadataPath '<existing public signing-metadata.json path>'
```

The build runs the offline suites, compiles `ExternalProbe.dll` for Windows PowerShell 5.1/.NET Framework, signs all executable scripts/module/DLL, requires valid timestamped SCCC signatures with one recorded leaf thumbprint, exports the **public** signer certificate, and writes file hashes and a release manifest into an immutable ZIP. The ZIP is a container; its executable payloads carry Authenticode signatures. Offline test sources remain in Git and are not installed. No MSI, scheduled task, certificate store, GPO or application is installed by the build.

## Deployment steps and approval point

**Stop before production changes.** Approve the exact source commits, RC ZIP SHA-256, exported public signer certificate/thumbprint, Fred change set, a named workstation, external origin, and data budget before the following steps. RC preparation alone is not deployment approval.

1. Revalidate live Fred source hashes; preserve a backup of affected source, API artifacts, frontend artifacts and service environment. Use a versioned candidate, not the superseded mutable staging command from the earlier task.
2. Deploy the reviewed Fred diagnostics code/UI with both feature and scheduler flags off, restart through the normal privileged service path, and verify public health and unauthorized API rejection. Do not deploy SCCC Key's unrelated personal/Store/backend changes.
3. On private `.22`, configure its dedicated worker credential and current AD/switch/AP sources. Fred remains public; no inbound exposure of `.22` is required. Existing result pulling carries the additional external metric fields unchanged.
4. After explicit pilot approval, enable diagnostics reporting and configure the external origin on Fred. Leave `BUILDING_DIAGNOSTICS_SCHEDULER_ENABLED=false` and `BUILDING_DIAGNOSTICS_EXTERNAL_SUSTAINED_ENABLED=false` for the quick pilot. Configure the daily byte budget deliberately.
5. Verify the exported public certificate against the manifest and approve/distribute that certificate to the pilot's **LocalMachine TrustedPublisher** store through normal authorized management. A valid signature or an installed MSI alone does not grant PowerShell publisher trust. Do not disable `AllSigned` or import an unverified certificate. Future Artifact Signing releases may use a new leaf certificate and require a new approved pin.
6. Export the exact workstation OU from AD. Use Fred's updated `Export-AdDiagnosticsInventory.ps1` with a named pilot, the signed RC payload directory, and the same `-ExternalProbeOrigin`. Kerberos verifies that computer; its independent device token is protected with machine DPAPI/ACL. Staging leaves its task disabled.
7. For the pilot only, verify the signed payloads and protected configuration, then activate using the manifest's exact signer thumbprint and normal task management. Confirm stable AD identity, recent check-in, adapter and location evidence, and external capability. Alert/MFA operation remains separate.
8. Select that one computer in Fred and request **one quick 5 MiB probe**. Verify 200/206 and exact bytes, timing/failure semantics, source/interface/building labels, server-derived Mbps, and the pulled report on `.22`. No fleet claim follows from a single successful pilot.
9. Sustained testing requires its own explicit schedule/data-use approval and both protected opt-ins. Verify cancellation on the pilot before any sustained rollout. Fleet GPO remains a later approval point.

## Rollback

Pause/cancel diagnostic jobs and allow running transfers to close or expire; disable the external/scheduler/reporting flags. Stop/disable only the diagnostics task and revoke its diagnostics credential. Restore backed-up Fred artifacts/source/environment and restart normally if a server rollback is needed. Retain audit/report data. Remove only this helper with its uninstaller; remove a newly distributed publisher certificate only after checking whether another approved signed application uses it. Existing alerts, MFA state, managed receiver, GPO links, and private monitoring services remain intact.

Unverified until the approved pilot: real workstation installation/startup, enterprise egress/proxy behavior, `.22` end-to-end ingestion, and any sustained download. No fleet or production deployment is part of this RC task.
