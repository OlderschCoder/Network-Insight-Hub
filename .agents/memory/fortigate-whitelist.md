---
name: FortiGate whitelist Network Tool
description: Scope/auth/reachability decisions for the FortiGate website-whitelist feature
---

# FortiGate website whitelist (Network Tool)

Ported from the user's Python Fortigate_Whitelist script into the app.

- **Auth = REST API token, not a login password.** The env secret is
  `FORTIGATE_API_TOKEN` (create a REST API Admin token on the FortiGate).
  **Why:** the user said "needs the fortigate user password", but a Bearer API
  token is the secure/standard REST auth and avoids storing an admin password.
  **How to apply:** don't add username/password login flows unless the user
  explicitly asks; keep token-based.
- **REST webfilter scope only.** The script's SSH/paramiko `ssl-exempt` +
  `wildcard-fqdn` automation was intentionally NOT ported.
  **Why:** SSH shell interaction from Node is fragile and was out of scope.
  **How to apply:** if a site is whitelisted but still blocked by SSL deep
  inspection, that's the missing SSH ssl-exempt piece — a known follow-up, not a
  bug in the current tool.
- **Reachability: FortiGate is a private IP (default 192.168.1.1).** The API
  server can only reach it when running on the SCCC network/VPN; off-network
  calls surface as HTTP 502. Same class of constraint as Grafana. Not a bug.
