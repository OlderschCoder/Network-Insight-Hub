# Windows helper source and signing

The currently deployed 1.1 release was built from SCCC-Key, diagnostics source commit `f6a9b43`, branch `codex/external-probe-rc`:
https://github.com/OlderschCoder/SCCC-Key/tree/f6a9b43/windows/diagnostics

The Fred copy now contains the prepared 1.2 LibreSpeed V2 integration. It is not an activatable release until these reviewed changes are reconciled into SCCC-Key, built through `windows/build-diagnostics.ps1`, and signed with SCCC's approved code-signing identity. This directory intentionally does not commit the third-party executable or contain a replacement signed release.

The release builder must stage LibreSpeed CLI 1.0.14 for Windows amd64 as `LibreSpeed/librespeed-cli.exe` with SHA-256 `5E01DF3986486419FEE84238204C3030FBBBE2E3145D4A2F5EF5EBCBAD7598D4` and its unmodified LGPLv3 `LICENSE` with SHA-256 `E3A994D82E644B03A792A930F574002658412F62407F5FEE083F2555C5F23118`. The signed installer and running module independently pin the executable hash. Do not substitute another build under the same version name.

See `EXTERNAL-PROBE-RC.md` for the existing release controls and rollback. The prepared helper identifies as `1.2.0-rc1`; no pilot or fleet activation is included.
