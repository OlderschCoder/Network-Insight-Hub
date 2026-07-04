---
name: Entra SSO on the self-hosted VM
description: Non-obvious gotchas that blocked Microsoft Entra SSO login on the self-hosted Azure VM deployment.
---

# Entra SSO on the self-hosted VM (the Hub)

Lessons from getting "Sign in with Microsoft" working end-to-end on the live VM
(`/opt/sccc-it`, systemd `sccc-api`, env in `.env.production`, not Replit Secrets).

## Group gate: use the Entra CLOUD Object Id, not the on-prem AD group
`ENTRA_ALLOWED_GROUP_IDS` must contain the group's **Entra (Azure portal) Object Id**
— the GUID emitted in the token `groups` claim. It is NOT the on-prem AD group name
or the GUID shown in ADUC ("Member Of" tab). Get it from portal.azure.com → Entra ID
→ Groups → open the group → Overview → Object Id.
- The claim only appears if Token configuration has a **groups** claim = Security
  groups, format **Group ID**, added to the **ID** token.
- On-prem AD groups (e.g. `InfoTech` in `sccc.edu/Groups/IT`) only work as a gate if
  Azure AD Connect syncs them to Entra. If the group can't be found in Entra ID →
  Groups, it isn't synced.
**Why:** the gate reads the token `groups` claim (cloud Object Ids). On-prem GUIDs
never match.
**Fallback if group sync is flaky:** switch to an **App Role** gate — define an app
role, assign it to the IT group/users, set `ENTRA_ALLOWED_APP_ROLES`. Sidesteps
group-sync entirely and is more deterministic.
**Diagnostic:** callback logs `Entra sign-in refused: not in IT group/role` when the
token is valid but the gate fails — auth pipeline is fine, only the gate value/claim
is wrong.

## Client secret gotcha
`AADSTS7000215: Invalid client secret` almost always means the **Secret ID** (a
36-char GUID) was pasted instead of the secret **Value** (~40 chars, shown only once
at creation). Recreate the secret, copy the Value.

## Legacy `password_hash` NOT NULL breaks SSO users
The old pre-SSO DB had `users.password_hash` as **NOT NULL**. The current schema makes
it nullable (SSO users have no local password). `ADD COLUMN IF NOT EXISTS` does NOT
relax an existing column, so on a legacy DB you must run:
`ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL;`
**Why:** the boot seeder's `stripNonBreakGlassPasswords()` sets password_hash=NULL for
non-break-glass rows, and new SSO users are inserted with no password — both fail
against a NOT NULL column (boot error + first-time SSO sign-in insert failure).
