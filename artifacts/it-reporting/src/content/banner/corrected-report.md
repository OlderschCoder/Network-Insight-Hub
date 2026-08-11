# Corrected EUP Student Provisioning Report

**Report date:** August 11, 2026  
**System:** Ellucian Ethos EUP, Microsoft Entra, and Google Workspace  
**Production report:** [Open the live EUP Provisioning Report](https://app-server2.centralus.cloudapp.azure.com:8443/admin/eup-provisioning)

## Executive summary

The student-account provisioning process now enforces the required order:

1. The student must be created in Microsoft Entra first.
2. The Entra account must be enabled.
3. Entra must contain the same student 800 number supplied by Ethos.
4. Only after all checks pass may the matching Google Workspace account be created.

The automation can no longer create a Google-only student account.

## Remediation results

The initial implementation created Google accounts without first verifying Entra. A full reconciliation was completed.

| Reconciliation result | Count |
|---|---:|
| Google accounts reviewed | 294 |
| Matching enabled Entra accounts confirmed | 2 |
| Google-only accounts identified | 292 |
| Google-only accounts deleted | 292 |

The exact reconciliation and deletion lists are retained in protected server logs. The report records the affected entries as **Deleted because Entra was missing**.

## Production status at correction

| Item | State |
|---|---|
| Provisioning worker | Active |
| Worker mode | Live |
| Last completed Ethos message | 483 |
| Next message | 484 |
| Current result | Waiting for Entra |
| Google account created for pending message | No |
| Current worker error | None |
| Administrative application | Healthy |

The pending message is held until its matching Entra account satisfies every prerequisite. The worker retries without advancing the cursor or creating Google.

## Corrected validation sequence

For each eligible `user-identity-profiles` message, the worker:

1. Confirms the resource is an Ethos user identity profile.
2. Confirms the Banner ID is a nine-digit student number in `800######` format.
3. Confirms the expected Entra username ends in `@sccc.edu`.
4. Confirms the expected Google address ends in `@g.sccc.edu`.
5. Queries Microsoft Graph for the exact Entra username.
6. Confirms the Entra account is enabled.
7. Confirms Entra `extensionAttribute2` contains the same 800 number.
8. If a prerequisite is missing, records **Waiting for Entra**, retains the message, and retries later.
9. If Entra is valid, checks whether Google already exists.
10. If Google exists, records **Already existed - no duplicate**.
11. Otherwise, creates Google using the approved initial-password convention.
12. Records the outcome without displaying or logging the password.

## Status meanings

| Report status | Meaning | Required response |
|---|---|---|
| Created Google account | Entra was verified and Google was created | Verify only |
| Already existed - no duplicate | Entra was verified and Google already existed | Verify only; do not duplicate |
| Waiting for Entra | Entra is missing, disabled, mismatched, or lacks the correct 800 number | Wait, then escalate if unresolved; do not create manually |
| Needs review | Source identity data is incomplete or invalid | Correct Banner/Ethos if authorized, otherwise escalate |
| Skipped non-student identity | No valid student 800 number was present | No action unless classification is wrong |
| Polling or automation error | A required service could not be reached | Notify IT; do not work around the error |
| Deleted because Entra was missing | Historical Google-only account was remediated | Do not recreate manually |

## Completion standard

Provisioning is complete only when:

1. The enabled `@sccc.edu` Entra account exists.
2. Entra `extensionAttribute2` contains the matching student 800 number.
3. The corresponding `@g.sccc.edu` Google account exists.
4. The report shows **Created Google account** or **Already existed - no duplicate**.

## Control statement

> No student Google Workspace account may be created unless the matching enabled Microsoft Entra account already exists and contains the same student 800 number.
