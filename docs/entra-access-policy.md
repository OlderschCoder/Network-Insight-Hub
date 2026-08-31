# Entra access policy for deployed SCCC applications

## IT operational applications

The following enterprise applications require assignment and grant access to the `InfoTech` group plus the CIO's individual continuity assignment:

- SCCC IT Reporting Hub
- SCCC_ACR
- ITSupport

The IT Reporting Hub also enforces membership inside the application through `ENTRA_ALLOWED_GROUP_IDS` and fails closed when no group or app-role gate is configured. Existing inactive Hub users remain denied.

## Purpose-built exceptions

`SCCC Student Access` is not restricted to IT because its intended workflow explicitly includes the assigned student and staff MFA groups. It already requires Entra assignment. Its student-facing authorization must not be silently replaced with the IT operational policy.

The separate `sccc.edu` registration also requires assignment and has named assignments. It is not classified as an IT operational application by this repository and must be reviewed with its owning workflow before altering access.

## Verification

For each IT operational enterprise application, verify `appRoleAssignmentRequired=true` and confirm that `InfoTech` remains assigned before removing any individual continuity assignment. Audit redirect URIs and assignments when deploying another SSO application. Do not rely solely on tenant membership or on an SSO login button; use both Entra assignment and application authorization where supported.
