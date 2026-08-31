# Student Account Provisioning Operating Procedure

**Audience:** Maria and authorized student-account staff  
**Effective date:** August 17, 2026
**Live report:** [EUP Provisioning Report](https://app-server2.centralus.cloudapp.azure.com:8443/admin/eup-provisioning)

## Maria's role

Maria normally verifies the result; she does not create the AD, Entra, Microsoft 365, Google, username, email, or password records manually.

## Normal procedure

1. Complete or verify the normal qualifying current-term admission decision in Banner.
2. Allow Banner's five-minute email job, Ellucian EUP, the ten-minute missed-account grace period, Entra Cloud Sync, the two-minute downstream worker, and the five-minute Banner identity reconcilers to run. A newly seen Entra identity may intentionally wait one additional two-minute worker cycle while its immutable identity index settles.
3. Open the EUP Provisioning Report and locate the student by name or 800 number.
4. Confirm the row shows the expected Banner/EUP AD login, the Entra **mail nickname** equal to the verified Banner Third Party ID/Canvas login, the exact active `STD` `@g.sccc.edu` address marked **preferred**, and a successful AD/Entra/Google result. A matching address that is merely present is not a completed GOAEMAL verification.
5. If the record is quarantined or remains incomplete, use the displayed reason and notify IT. The health monitor also emails `itech@sccc.edu` and `mark.bojeun@sccc.edu` for missed students, quarantines, and stale services.

`Scheduled for Banner role start` is a normal future-dated state, not an error. The report distinguishes a GOAEMAL row that is merely present from the exact active student row that Banner actually marks preferred. A five-minute read-only verifier checks the Banner Third Party ID; the separate guarded GOAEMAL preference reconciler checks the exact preferred address for the displayed non-staff cohort. Escalate only if the row remains in review after the next verification cycle.

The ENTRACLOUDCON policy is active for students created after the August 31, 2026 immutable cutover. It populates AD `mailNickname` only after the signed manifest exposes the exact preferred-email local part as the Banner Third Party ID and collision checks pass. Existing accounts remain verification-only unless an administrator approves an exact correction. `Still processing` is a normal hold; `Review` identifies a genuine proof, length, collision, or directory defect.

Automation activity is grouped by the student's Banner 800 number and shows that 800 number in the **800 number / message** column. Several retries, license checks, or verifications for one person therefore appear as one latest student outcome, not several outstanding students. A resolved pre-inventory account may appear here without increasing the current-inventory count.

At the August 20 18:33 UTC identity-first checkpoint, the expanded accepted-student union verified **250 of 250** Third Party IDs and **250 of 250** exact preferred GOAEMAL rows, with no current review item. This is a checkpoint, not a fixed enrollment count: the cohort grows as Banner accepts additional students. Do not manually create or rename an account merely because a new row is still inside the normal processing window.

## Staff/student classification

The automated process searches by exact Banner 800 number and EID before using a name-derived login. An exact identity outside `OU=StudentPopulation` is staff and must be excluded before student licensing, Google creation, GOAEMAL correction, and student-report inclusion. An exact identity in StudentPopulation whose canonical login conflicts with Banner is quarantined for reviewed correction.

Patty Volden (`800012073`) is the proven staff example: `patty.volden@sccc.edu` remains her staff identity with staff/faculty licensing and Exchange. She must not receive a student license or `@g.sccc.edu` Google account. A staff user's name differing from Banner's formal first name is not permission to create another account.

## Immutable identity and duplicate-account checks

Names are for display and human review; they are not safe account keys. The worker indexes Entra by the immutable Microsoft Graph object ID. Deployment verification produced a 6,547-entry index. Repeated delta changes for the same object are collapsed, while different objects claiming the same Banner 800 number are quarantined rather than selected arbitrarily.

Kylie Jo Ann Noland (`800190749`) is the verified example. `Jo Ann` is one middle name in Banner. Banner, the one current AD object, the synchronized Entra object, and the Google student account all resolve to the same student identity. Locate and validate her 800 number in AD Description and `extensionAttribute2`; it must not be appended to the AD Name/CN.

The Google guard will not adopt or add the SCCC Banner ID marker to an existing untagged account merely because its first and last names resemble the student. It also checks primary addresses, aliases, and existing Banner markers for a different owner. Any ambiguity is held for IT review. This is why a genuinely new identity may take one extra two-minute cycle before Google processing.

The five-minute AD snapshot checks the full StudentPopulation inventory for duplicate Banner ID, EID, UPN, `sAMAccountName`, and mail values. A collision marks every involved object for review and triggers a de-duplicated critical health email. Existing conflicts are quarantined and remain unchanged until IT approves an exact correction; this check is not authorization for bulk modification.

When a Banner ID collision is reported, compare each object's `extensionAttribute2` with its own Description, Banner profile, EID/UDC, AD object GUID, and synchronized Entra object ID. A former name or similar name is supporting context only. If one unrelated object carries another person's Banner number, correct only that exact object's stale `extensionAttribute2` after Banner read-back and target-value uniqueness checks. Preserve its username, mail, groups, licenses, enabled state, and all other fields.

If an Entra collision remains after the live AD markers are unique, decode the Entra `onPremisesImmutableId` and search all domain controllers plus the AD Recycle Bin. An Entra record may be removed only when its immutable source object is proven deleted, the legitimate current owner is independently exact-matched, and sign-in/activity risk has been reviewed. Use a recoverable soft deletion and verify the object in Entra Deleted Users. Never delete an account merely because a name changed.

## Resolving a held existing student

Do not create another account merely because an accepted student's existing AD account is disabled or a Google identity check is held.

IT must first resolve exactly one StudentPopulation AD object by the Banner 800 number and Banner EID, then verify its immutable object identity, UPN, mail, `description`, and `extensionAttribute2`. If all identity values are exact and the only defect is the disabled state, IT may enable that one approved object and must read the same object back as enabled. Any identity mismatch remains quarantined.

For Google, IT must verify the existing account is active and that `externalIds` contains exactly one custom marker named **SCCC Banner ID** whose value is the same 800 number. The marker-owner search must resolve only to that Google primary account. A name match is never sufficient evidence.

The two-minute worker now revisits both `waiting_for_entra` and `identity_collision` holds. Once exact ownership is verified, it releases the hold and records the latest resolved outcome automatically. Hudson Horn (`800201698`) is the proven example: his one verified AD object was enabled, `hudson.horn@g.sccc.edu` was confirmed as the sole owner of the `800201698` Google marker, and the worker recorded **already exists — Banner ID verified**. Because Hudson predates the report's inventory start, his resolution belongs in Automation activity and does not change the 250-person checkpoint.

## Automatic GOAEMAL preferred-address correction

The corrected process always uses the supported singular Banner email-address BPAPI. For each eligible non-staff student, the reconciler requires an exact match among the Banner ID, Banner person ID, and active `STD` canonical `@g.sccc.edu` address before it may act.

If the verified student row is not preferred, the reconciler:

1. identifies the one currently preferred row;
2. demotes only that exact row;
3. promotes only the exact verified active `STD` student row;
4. reads the result back through both Banner API views; and
5. restores the former preferred row if promotion or read-back fails.

A missing match, duplicate match, staff identity, multiple preferred rows, or API/read-back failure is quarantined and reported instead of guessed. The health monitor alerts `itech@sccc.edu` and `mark.bojeun@sccc.edu` when the reconciler is stale or reports a real exception. Routine processing and normal timing do not generate failure alerts.

Google verification is refreshed read-only every 30 minutes. Before checking Google, the service removes exact staff exclusions and eligibility holds from its candidate set. This refresh validates current account state for the report and recovery ledger; it does not create or change Google users.

For a direct AD check, search `Description` using the complete `800######` number first. Before any correction, verify that `extensionAttribute2` contains the same number and the object is in the StudentPopulation OU. A mismatch, duplicate, or staff object must be referred to IT and must not be changed as a student.

## AD name and identifier-field standard

For a newly provisioned student, verify all of the following:

1. **Name/CN and Display name** contain the Banner/EUP formatted student name only. Do not append `(800######)`, `[800######]`, or any other student-number suffix.
2. **Description** contains the exact Banner `800######` number.
3. **`extensionAttribute2`** contains the same exact Banner `800######` number.
4. **`extensionAttribute1`** contains the Banner-generated EID.
5. **`employeeID` and `employeeNumber`** remain blank under this student-provisioning contract.

AgentAD maps `cn` from `personIdentity.personName.formattedName`. The guarded AD fallback implements the same rule, so both creation paths now produce a clean AD Name/CN while retaining the 800 number in the two approved lookup fields. Search by Description first and confirm `extensionAttribute2` before taking action; do not repurpose `employeeID` or `employeeNumber`.

Kylie Jo Ann Noland (`800190749`) was corrected as a one-account canary by renaming only the existing AD Name/CN to `Kylie Jo Ann Noland`. Her immutable GUID and all login, mail, and Banner identity attributes stayed unchanged. The audit found 143 additional legacy CN suffixes. Do not rename them in bulk without explicit approval. Treat the separate Christina naming anomaly as its own reviewed case rather than folding it into a CN cleanup.

The student AD UPN uses the canonical `@sccc.edu` login and the legacy `sAMAccountName` may be truncated to its 20-character limit. The canonical Canvas login and AD/Entra `mailNickname` are the local part of the sole active, preferred `STD` GOAEMAL address generated by EUP. GOATPAD must consume that value rather than generate a first-initial alternative. The value is accepted only after Banner 800 number, person UUID, EID/UDC, preferred email, uniqueness, and the GOATPAD 30-character boundary are verified. A value that exceeds the boundary is quarantined for an upstream EUP naming decision and is never silently truncated downstream.

The primary Canvas SAML provider sends Entra `user.mailnickname` as `NameID`, does not strip a domain, and does not perform just-in-time account creation. Canvas therefore requires that value to match its existing login `unique_id` exactly. A mismatch produces the familiar “Canvas doesn't have an account for user” error even when the AD account, UPN, and email are otherwise valid. A legacy second SAML provider still uses UPN with domain stripping; do not use that duplicate path to hide a bad primary-provider identity.

The Banner read-back, read-only Third Party verifier, and guarded GOAEMAL preference reconciler use the union of recent Entra activity and all current accepted-monitor records. An older accepted student is therefore still checked even when the account predates the latest Google-verification window. The routine Third Party job never changes GOATPAD. A Banner credential change requires explicit approval for one exact account and a separate one-account correction tool. The GOAEMAL reconciler may change only an exact verified preferred flag; neither job treats an absent recent-Google record as permission to invent an identity.

## What not to do

- Do not manually create Google while AD/Entra is pending.
- Do not invent a username or duplicate suffix.
- Do not use a matching name by itself to adopt, tag, merge, or create an AD, Entra, or Google identity.
- Do not select one of two objects that claim the same Banner ID; leave the collision quarantined for IT.
- Do not place the 800 number in the AD Name/CN, `employeeID`, or `employeeNumber`; use only Description and `extensionAttribute2` for the 800 number.
- Do not treat address presence as proof that the GOAEMAL row is preferred.
- Do not use the plural canonical email-address resource to change GOAEMAL preference; the production reconciler uses the supported singular BPAPI with exact read-back and rollback.
- Do not create a second account when the report says the identity already exists.
- Do not change a historical user merely to make the inventory look uniform.
- Do not request or perform a bulk user correction without an approved, reviewed change.
- Do not send or record a password in email, tickets, spreadsheets, or screenshots.

## Canvas email exception

Changing an AD UPN, GOAEMAL preferred address, or Google account does not necessarily update an existing Canvas communication address. If Canvas shows an older address while the SIS ID, Canvas login, and enrollments are correct, send the exact Canvas user ID, Banner 800 number, old address, and verified replacement address to IT.

IT must change only the Canvas communication/primary email after an exact identity check. Preserve the Canvas user ID, SIS ID, institutional login, courses, and enrollments. Jorge Frias (`800201754`) is the current example: his Canvas login and six active enrollments are correct, while the primary email still shows `jfrias@g.sccc.edu` instead of `jorge.frias@g.sccc.edu`.

Rebekah Hall (`800201799`) is the completed exact-correction example. Canvas user `20139`, login pseudonym `35233`, login `rebekah.hall`, SIS ID `800201799`, and primary channel `24102` (`rebekah.hall@g.sccc.edu`) were already correct. IT retired only stale channel `24095` (`rhall5@g.sccc.edu`) after searches confirmed there was no duplicate Canvas user. Her Canvas enrollment list is currently empty; any valid course enrollment requires an official Banner registration and the separately owned Canvas enrollment integration. Do not enroll the student manually merely to repair identity. The integration publisher/location/schedule is an open ownership item, not an ACR write function.

For the related AD cleanup, change only the Name/CN after confirming one immutable object by Description and `extensionAttribute2`. Rebekah's object GUID, UPN, mail, Banner ID/EID values, and required groups were preserved while `Rebekah Hall (800201799)` became `Rebekah Hall`. Retain the exact evidence file and hash with the incident record: `C:\Users\mark.bojeun\Documents\ChatGPT\Banner\rebekah-canvas-correction-evidence-20260820.json`, SHA-256 `2887b5c824ad6cb2ea7112d8cc61289aa059228b81da2a26a2788c0785393bb2`.

## ACR recovery copy

At 3:30 AM Central each day, Production ACR commits a sanitized append-only snapshot of accepted Ellucian admissions and exact verified directory/Banner mappings. The ledger is a disaster-recovery reference only; it never creates, changes, or bulk-recovers users. A failed or partial collection cannot replace the prior last-good snapshot.

Off-host encrypted export is not active until IT supplies an `age` public recipient and approves a destination and retention policy. Until then, the local ledger should not be described as protection from complete loss of `app-server2`.

## Exception information for IT

Send the student's name, 800 number, date/time, report status, and exact displayed reason. Include the expected AD login and Google address only if shown by the report. Never include a password.

## Completion standard

Provisioning is complete when the report confirms:

1. the enabled student AD/Entra identity with the matching 800 number;
2. the Microsoft 365 A1 Student no-Exchange assignment;
3. the active Banner/Ethos `@g.sccc.edu` Google account;
4. the verified live Banner Third Party ID/Canvas login;
5. AD `mailNickname`, synchronized Entra Alias/SAML `NameID`, and Canvas login `unique_id` all exactly equal that verified Banner credential;
6. the exact active `STD` GOAEMAL address is marked preferred; and
7. no current accepted-student issue or quarantine.

No recurring Codex session is required. The production services and scheduled tasks run automatically; IT responds only to an emailed or reported exception.

After any worker deployment, IT must also verify that the Banner verification, Banner email backstop, GOAEMAL audit/fix and reconciliation, and Google verification scripts are still installed and that their systemd timers are enabled and active. The worker executable and its operational scripts are one solution; successfully replacing only the executable is not a complete deployment.
