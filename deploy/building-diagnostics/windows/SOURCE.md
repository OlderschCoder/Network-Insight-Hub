# Windows helper source and signing

Canonical source is SCCC-Key, diagnostics source commit `f6a9b43`, branch `codex/external-probe-rc`:
https://github.com/OlderschCoder/SCCC-Key/tree/f6a9b43/windows/diagnostics

This directory is the matching operator/source snapshot. Build and sign the Windows release through `windows/build-diagnostics.ps1` in SCCC-Key. Use the signed RC payload for provisioning; this source snapshot does not contain the compiled/signed DLL and must not be activated directly.

See `EXTERNAL-PROBE-RC.md` for exact configuration, approval, selected-pilot steps and rollback. Current RC is `1.1.0-rc1`. No fleet activation is included.
