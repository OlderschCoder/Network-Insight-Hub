# Diagnostics agent 1.2.1 enrollment

This is the finite enrollment-only path for the fresh reviewed Fred request that covers eligible AD workstations not already enrolled. It does not queue performance measurements, change GPO/MFA/alerting, or regenerate the existing protected bulk-worker credential.

1. In Fred, select all eligible unenrolled computers and create one enrollment request. Record its UUID.
2. From an elevated PowerShell 7 console on `LP-AA152MB-01`, stage the signed immutable 1.2.1 release:

   ```powershell
   & '.\deploy\building-diagnostics\Stage-DiagnosticsEnrollment121.ps1' `
     -ReleaseRoot 'C:\Users\mark.bojeun\Documents\Codex\2026-10-25\device-performance\SCCC-Key\artifacts\windows\diagnostics-release\1.2.1'
   ```

3. Validate the exact request without starting it:

   ```powershell
   & 'C:\ProgramData\SCCC-DiagnosticsBulkController\Invoke-DiagnosticsEnrollment121.ps1' `
     -RequestId '<reviewed-request-uuid>' -MaximumTargets 400
   ```

4. Start only after the validation output reports `ValidatedNotStarted`, agent `1.2.1`, the reviewed request UUID, `MeasurementsRequested: false`, and the expected finite maximum:

   ```powershell
   & 'C:\ProgramData\SCCC-DiagnosticsBulkController\Invoke-DiagnosticsEnrollment121.ps1' `
     -RequestId '<reviewed-request-uuid>' -MaximumTargets 400 -Execute
   ```

The controller uses private SCCC DNS, Kerberos, the existing DPAPI-protected worker credential, exact AD object identity, pinned payload hashes, and the exact public SCCC signing certificate. Unreachable endpoints are recorded as unreachable; uncertain one-time credential delivery stops the controller without replay.
