---
name: Network Tools PowerShell script generators
description: Why the printer/laptop/equipment tools generate scripts instead of executing them
---

# Network Tools: PowerShell script generators

The "Install Printer", "Add Laptop", and "Remove Equipment" tools on
`/network/tools` are **client-side script generators** — they template a
ready-to-run `.ps1` from form inputs (copy + download), they do NOT execute
anything server-side.

- **Why:** these tasks act on an individual Windows workstation (Add-Printer,
  Rename-Computer, Remove-ADComputer, etc.). A hosted Linux web app can't run
  Windows admin commands on a staff machine without a per-machine agent — out of
  scope. So the deliverable is a generated script the tech runs locally. This is
  fundamentally different from the FortiGate whitelist, which is a live REST call
  to a network appliance.
- **How to apply:** if asked to make these "actually run," that requires an agent
  on each endpoint (or RMM/Intune) — flag it as a much larger project, don't try
  to shell out from the server.
- **Injection safety:** all user strings interpolated into generated PowerShell
  must go through `psQuote` (escapes `'` → `''`). Numeric/unquoted sinks (e.g.
  `-PrefixLength`) must be separately validated (integer-range clamp), because
  psQuote only protects single-quoted string contexts.
- Domain-join credentials are never embedded — the generated script prompts at
  runtime via `Get-Credential`.
