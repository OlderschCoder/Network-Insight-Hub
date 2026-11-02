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
