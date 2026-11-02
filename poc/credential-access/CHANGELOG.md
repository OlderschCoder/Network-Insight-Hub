# November 2, 2026 — Credential access POC

- Added an isolated SSO-session-authenticated sidecar and protected reveal page.
- Scoped live operations to AA151-CIO (192.168.252.173), existing admin account.
- Added encrypted staging/current/rollback credentials, encrypted config backup,
  verified reset/save/reconnect, borrower audit, and retryable email notifications.
- Added independently encrypted recovery export, recovery verification, a local
  safe-kit synchronization utility, and standalone offline recovery instructions.
- Deployment verified the existing administrator login and detected configured SMTP.
  Deployment itself made no device password changes.
- Fourteen targeted lifecycle/authorization tests passed, including a real HTTP
  request with a forged caller identity and no valid session; it was rejected.
- Deployed release: 20261102T120902Z on app-server2; separate service port 9137.
  Page: https://insights.sccc.edu/credential-poc (also on the app-server2 hostname).
- Backed-up nginx configuration:
  `/home/scccadmin/apps/fred-credential-poc/backups/20261102T120902Z`.
  Corrected the new static-file route before handoff; nginx configuration validated.
- Fred model/tool integration and expansion beyond this one device remain outside
  this first POC. The supplied common password is bootstrap-only: a completed
  return/reset replaces it with a unique password held in the encrypted vault.
- Live issuance/reset/email receipt and physical USB recovery are pending the
  authenticated operator's test; do not report those as completed from deployment.

## Operator-assisted first live password test

- At the CIO's explicit request, applied the supplied initial test password to
  AA151-CIO's existing admin account. Encrypted staging/configuration backup,
  fresh privileged login, configuration save, and post-save fresh login passed.
- The CIO independently confirmed the supplied test password worked. It remains
  current; no checkout or generated post-use reset was performed in this step.
- Recorded actual CIO identity plus the separate operator/SSH authorization
  channel. No Hub session was created, borrowed, or impersonated.
- Independently encrypted recovery export verified at version 5 with one target.
  Copied encrypted recovery artifacts into the ACL-restricted local safe-kit folder
  under `Documents/Network-Changes/2026-11-02-Fred-Credential-POC/Safe-Kit`.
  Physical USB/envelope preparation and offline-laptop testing remain outstanding.
- Initial-change notification remains durably pending. SMTP rejected authentication
  with code 535. The POC's SMTP settings match the running Hub's effective settings;
  no email credentials, tenant settings, or authentication protections were changed.
