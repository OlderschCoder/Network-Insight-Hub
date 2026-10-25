# Managed Windows diagnostics helper

This independent PowerShell 5.1 helper reports AD workstation presence and adapter metadata to Fred. It runs capped HTTPS measurements only when Fred returns a short-lived, device-bound HMAC-authenticated job. It does not read or change `SCCCAlertReceiver`, MFA keys, alert registration, or emergency permissions.

## Provision and stage

The trusted private collector must verify the enabled AD object and computer using Kerberos, provision its independent Fred diagnostics identity, and place that computer's one-time JSON input in an administrator/SYSTEM-only local directory. Do not put credentials in SYSVOL, GPO arguments, a public download, or a shared fleet configuration. Input fields are `serverUrl` (HTTPS DNS origin only), `deviceId`, `deviceToken`, `computerName`, and `domain`. Both input and its immediate parent need a protected ACL granting only SYSTEM and Administrators; the private provisioner is responsible for this.

Run locally/remotely as administrator with no secrets in command arguments:

```powershell
.\Install-DiagnosticsAgent.ps1 -ProvisioningFile 'C:\ProgramData\SCCC\DiagnosticsProvisioning\device.json' -ExpectedDomain 'sccc.edu'
```

Default staging creates **a disabled scheduled task**, not a running fleet deployment. Delete the protected plaintext input immediately after successful installation. The installed token uses DPAPI LocalMachine plus protected SYSTEM/Administrators ACLs. Local administrators remain trusted; DPAPI is not a boundary against an administrator.

The provisioner must Authenticode-sign and verify `Invoke-DiagnosticsAgent.ps1` and `Sccc.Diagnostics.psm1` with SCCC's approved signing identity before using `-Activate -SignerThumbprint <approved-certificate-thumbprint>`. The installer verifies the signer again on the protected installed files. The task uses Windows PowerShell with `AllSigned`, starts as SYSTEM at boot, restarts on failure, and sends a check-in every 60–70 seconds. No policy or certificate-store bypass is included. For an existing staged installation, verify signatures on the installed files, then explicitly enable and start **only the pilot task** using normal management tooling. Do not activate a GPO until pilot acceptance.

```powershell
# Configuration validation only: no AD query, scheduled task, or network call.
.\Invoke-DiagnosticsAgent.ps1 -ValidateOnly
# Offline parser, proof, byte-budget, and synthetic HTTP stream tests.
powershell.exe -NoProfile -File .\Test-DiagnosticsAgent.ps1
```

## Measurements and location

The payload includes computer/domain claim, uptime, current console user when available, adapter MAC/IP/default gateway and negotiated link Mbps. Those AD claims do not verify directory membership: the private collector's authoritative enabled AD roster does. A read-only Native Wi-Fi query includes the current BSSID/SSID when Windows permits it; service or location-permission restrictions leave those fields absent. The private switch/AP correlation supplies location evidence. No SNMP, password, browser identity token, or alert credential is collected. A disconnected session or multiple simultaneous user sessions is not a reliable phone-building association.

Each job permits at most 32 MiB each way and ten HTTP probes; each request/transfer has a 30-second bound. Redirects are disabled and Windows validates TLS normally. The fixed endpoint paths cannot run commands or target another host. The helper verifies a per-device HMAC over job ID, device ID, exact expiry, transfer bytes and probe count before making measurement requests. Fred also validates leases, transfer receipts and replay. A local self-test does not prove a real signed installer or production pilot.

Mbps is actual HTTP transfer bytes divided by elapsed time. Latency and loss describe HTTPS requests, not ICMP packet loss, and a single endpoint measurement does not establish the campus uplink's full capacity. Fred's scheduler must stagger tests and label path, location evidence and freshness.

## Roll back

Disable/stop the diagnostics task first, revoke its independent credential centrally, then run `Uninstall-DiagnosticsAgent.ps1` as administrator. It validates the fixed folder and refuses unexpected content; it removes only its own three installed files and task. It leaves the alert service and MFA untouched. Stage a fresh provisioned identity for an update rather than silently overwriting an existing installation.
