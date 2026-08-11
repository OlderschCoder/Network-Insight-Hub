# EUP Provisioning Full Change Log

**Coverage:** Initial implementation through the August 11, 2026 correction and remediation  
**Systems:** Banner, Ellucian Ethos/EUP, Microsoft Entra, Google Workspace, and the SCCC administrative report

## August 7, 2026 — Foundation work

- Established the custom SCCC EUP provisioning workflow and administrative reporting direction.
- Defined the intended student identity flow from Banner/Ethos into institutional account systems.
- Began replacing the former manual username, email, and Google account workaround.
- Identified the EUP Provisioning Report as both a stand-alone operational report and an IT Insight Hub resource.

## August 10, 2026 — Worker and integration setup

- Configured Ellucian Ethos API access for `user-identity-profiles` messages.
- Configured Google Workspace service-account access and domain-wide delegation.
- Set the Ethos cursor baseline and enabled processing for new messages going forward.
- Added an administrative activity table so staff can see what the automation processed and the result of each message.
- Added status reporting for created accounts, existing accounts, skipped identities, records needing review, and worker errors.
- Added duplicate protection so an existing Google user is not created again.
- Added log de-duplication so repeated polling does not flood the report with identical activity.
- Corrected an Ethos request problem caused by a duplicate `Authorization` header and stabilized repeated polling.

## August 11, 2026 — Incident discovered

- Determined that the initial eligibility filter was too broad and allowed service/API identities into the Google provisioning path.
- Determined that Google creation did not require a matching Entra identity first.
- Stopped the worker before further Google-only accounts could be created.
- Confirmed the institutional rule: **no student may be created in Google unless the corresponding enabled Entra identity already exists with the same 800 number**.

## August 11, 2026 — Corrective controls

- Restricted eligible student IDs to the nine-digit `800######` format.
- Added an exact Microsoft Graph lookup for the expected `@sccc.edu` user principal name.
- Added a required check that the Entra account is enabled.
- Added a required match between the Ethos/Banner 800 number and Entra `extensionAttribute2`.
- Added validation for the expected `@sccc.edu` and `@g.sccc.edu` domains.
- Added a hard **Waiting for Entra** gate. A blocked message remains pending and is retried; the cursor does not advance to later creation work.
- Ensured the Google API is not called when any Entra prerequisite fails.
- Preserved the approved initial-password convention inside the worker while preventing passwords from appearing in logs, email, tickets, or the report.
- Restarted the worker only after the Entra-first controls were installed.

## August 11, 2026 — Reconciliation and cleanup

- Reconciled 294 Google accounts created by the initial run against Microsoft Entra.
- Confirmed 2 accounts had matching enabled Entra identities.
- Identified 292 Google-only accounts without the required Entra prerequisite.
- Suspended the 292 noncompliant accounts as an immediate containment measure.
- Deleted all 292 Google-only accounts after cleanup was authorized.
- Updated the activity ledger to show **Deleted because Entra was missing** for the remediated records.
- Retained exact reconciliation and deletion evidence in access-controlled server logs.

## August 11, 2026 — Security and reliability follow-up

- Removed the exposed Google service-account key and replaced the credential path.
- Hardened permissions on production secrets and provisioning state.
- Confirmed passwords are neither logged nor displayed in the reporting interface.
- Confirmed the administrative application and provisioning service were healthy after remediation.
- Confirmed the worker held the next unqualified message at **Waiting for Entra**, created no Google account, reported no worker error, and avoided duplicate audit rows.

## August 11, 2026 — Documentation and visibility

- Corrected the provisioning report to distinguish automation activity from the existing-account inventory.
- Documented Maria's role as verification and exception reporting—not manual account provisioning.
- Published the corrected report, Operating Procedure, and this full change log under the Banner section of the IT Insight Hub.
- Retained the live EUP Provisioning Report as a stand-alone operational view.

## Current enforced process

`Banner → Ethos/EUP → Entra → enabled-account and 800-number validation → Google Workspace → activity report`

If Entra is absent, disabled, mismatched, or missing the correct 800 number, processing stops at **Waiting for Entra**. Staff must not manually create the Google account to work around that control.
