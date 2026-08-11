# Student Account Provisioning Operating Procedure

**Audience:** Maria and authorized student-account staff  
**Effective date:** August 11, 2026  
**Report:** [EUP Provisioning Report](https://app-server2.centralus.cloudapp.azure.com:8443/admin/eup-provisioning)

## Purpose

This operating procedure replaces the former manual workaround for creating student usernames, email addresses, passwords, and Google Workspace accounts.

The automated sequence is:

`Banner → Ethos/EUP → Entra → Entra validation → Google Workspace → EUP Provisioning Report`

## Maria's role

Maria's normal responsibility is **verification and exception reporting**, not account creation.

Maria should:

- Verify successful results in the EUP Provisioning Report.
- Confirm or correct Banner information only when Banner maintenance is already part of her assigned duties.
- Report unresolved exceptions to IT.

Maria should **not** manually create Entra accounts, Google accounts, usernames, email addresses, or initial passwords. When automation stops, report the exception instead of completing the failed process manually.

## Normal operating steps

### 1. Confirm the Banner record, when applicable

If Banner maintenance is part of Maria's assigned duties, follow the approved Banner process and verify the student's name, 800 number, and eligible-student status. If another office owns the Banner entry, Maria does not perform this step.

Do not invent a username or alter data merely to force provisioning.

### 2. Allow the automated process to run

Banner/Ethos sends the eligible student identity. The configured identity process creates Entra. The Google worker then verifies:

- The exact `firstname.lastname@sccc.edu` identity exists.
- The account is enabled.
- Entra `extensionAttribute2` contains the same `800######` number.
- The Entra and Google usernames correspond.

Maria does not create either account.

### 3. Open the report

Open the [EUP Provisioning Report](https://app-server2.centralus.cloudapp.azure.com:8443/admin/eup-provisioning) and sign in with an authorized SCCC account.

Use **Automation activity** as the authoritative record of what the new process did. **Existing student account inventory** is only a reference and can include accounts made under the old manual process.

### 4. Locate and verify the student

Find the record by name, 800 number, expected username/email, Ethos message number, or processing time. Newest activity appears first; the page refreshes automatically, and **Refresh now** is also available.

### 5. Act only on the displayed status

#### Created Google account

Verify the student information and successful outcome. No account creation is needed.

#### Already existed - no duplicate

Verify the result. Do not create another account. Use the approved support or password-reset process for sign-in problems.

#### Waiting for Entra

1. Do not create Google manually.
2. Allow the normal Entra provisioning window to pass.
3. Refresh the report.
4. If still waiting, notify IT with the student name, 800 number, Ethos message number, time, and displayed detail.
5. Do not send a password.

The worker retains and retries the message. It cannot proceed to Google until Entra is valid.

#### Needs review

Correct Banner/Ethos information only when the correction is within your assigned responsibility. Otherwise, escalate the displayed detail to IT. Do not bypass the issue with manual account creation.

#### Skipped non-student identity

No action is required unless the person should be an eligible student. If so, request correction of the Banner classification.

#### Polling or automation error

Notify IT with the message number, time, and displayed error. Do not create accounts manually during an error.

#### Deleted because Entra was missing

This is a remediation record from the initial implementation. Do not recreate the account. Google may be created later only after the proper Entra identity exists.

## Exception information to send IT

Send only:

- Student name
- 800 number
- Expected SCCC username
- Ethos message number
- Date and time
- Report status
- Exact report detail

Never include a password in email, tickets, spreadsheets, screenshots, or shared notes.

## Completion standard

The student is complete only when the enabled Entra identity exists with the correct 800 number, the matching Google identity exists, and the report states **Created Google account** or **Already existed - no duplicate**.

## Discontinued workarounds

- Manually constructing usernames or email addresses.
- Creating Google before Entra.
- Creating Google while the report says **Waiting for Entra**.
- Creating a duplicate when the report says **Already existed**.
- Changing source data merely to force account creation.
- Treating inventory counts as proof of automated creation.
- Recording initial passwords in email, tickets, spreadsheets, or shared notes.
