# Corrected EUP Student Provisioning Report

**Report date:** August 21, 2026
**Environment:** Production
**Live operations:** [Open the stand-alone EUP Provisioning Report](https://app-server2.centralus.cloudapp.azure.com:8443/admin/eup-provisioning)

## Current status

The orphan-account failure path is resolved. Ellucian EUP remains the primary AD-creation path, while an independent accepted/current-term monitor now detects a qualifying student that EUP did not deliver. After a ten-minute EUP grace period, the guarded recovery may create only that missing student through the standard StudentPopulation contract.

| Verified result | Count |
|---|---:|
| Current accepted-monitor records checked | 128 |
| Fully provisioned eligible students | 127 |
| Exact staff identity excluded before student actions | 1 |
| Eligible accepted students still incomplete | 0 |
| Active Google accounts in the live merged report | 251 |
| Recent-cutover Google verifier accounts active | 226 |
| Recent-cutover candidates excluded by staff/eligibility guards | 5 |
| Google missing or needing review | 0 |

The August 17 recovery remains an important historical checkpoint: all 11 students recovered in that run reached on-premises AD, Entra, the Microsoft 365 A1 Student no-Exchange licensing group, and Google. Google remains gated behind Entra verification.

## August 21 targeted identity-collision resolution

The reported collision list was not one problem repeated ten times. It contained legitimate name history, unrelated accounts carrying copied AD identity markers, two partially completed prior corrections, and two Entra objects whose source AD accounts had already been deleted.

IT resolved every listed owner from Banner ID plus Banner EID/UDC and immutable directory IDs before making a change. Nineteen exact AD objects had a stale `extensionAttribute2` copied from another person; each was changed to the Banner number already present in that object's own Description. LaDanity Timmons and Maricruz Haines also received their exact live Banner EIDs. No username, email address, name, group, license, password, or enabled state was changed.

The two Entra-only records for `Estesfany Sanchez` and `Felipe Payan` mapped by immutable ID to deleted AD objects and had no successful Entra sign-in. Only those orphaned Entra objects were soft-deleted and verified in Deleted Users; the legitimate Estefany Sanchez and Lidice Martinez Rodriguez identities remained active. After normal Cloud Sync and Entra delta processing, each of the nine reported Banner numbers and both reported EIDs had exactly one indexed owner.

This work did not merge people because of similar names. Tara Thompson and Laura Rodriguez Esquivel retained their existing immutable accounts and Banner identity through their name history. The correction removed unrelated copied markers that had made the guard correctly refuse to choose an owner.

## Current 251-student verified checkpoint

The live merged report refreshed at **August 20, 2026, 4:10:12 PM Central** with **251 of 251** core provisioning/email records verified: 251 AD/Entra object matches, 251 active Google accounts, 251 verified student AD mail mappings, 251 GOAEMAL rows found and preferred, and 251 exact live Banner Third Party IDs. A later, stricter Canvas SAML alias audit is a separate control and found two legacy AD/Entra `mailNickname` mismatches pending exact scoped approval; those findings do not invalidate the 251 core object/email results.

Cruz Moradelizarraga (`800201815`) supplied an end-to-end test of the normal fail-closed process. The guarded Banner backstop added the canonical active `STD` address while preserving a legacy preferred address. The first preference audit raced the new 251st cohort and reported the record for later review rather than guessing. At **2026-08-20 21:03:40 UTC**, the normal five-minute reconciler selected exactly that one Banner/person/address match, demoted the prior preferred row, promoted the canonical row, and verified both supported API writes by read-back. No manual user or bulk change was made. Final read-back showed 251 preferred, 0 nonpreferred, 0 ambiguous, and 0 API errors; AD, Entra, Google, licensing, GOATPAD, and GOAEMAL all matched the same identity.

## Hudson Horn resolved exception

Hudson Horn (`800201698`) was accepted before the live report's current inventory start and therefore is **not** an additional row in the 250-person start-date inventory. He appears in Automation activity as the latest resolved student outcome.

IT verified one exact StudentPopulation AD object by both Banner ID `800201698` and Banner EID `0F61942AF61D432F9E7692D391345FE1`. The object's immutable identity, `hudson.horn@sccc.edu` UPN, `hudson.horn@g.sccc.edu` mail value, and Banner attributes already matched; only the disabled account state was changed. The same AD object was enabled and read back as enabled. No account was created, renamed, or merged.

The existing Google object was then verified as active with exactly one custom `externalIds` marker named **SCCC Banner ID**, value `800201698`. The marker-owner audit resolved that value only to `hudson.horn@g.sccc.edu`. The recurring hold processor rechecked the former `identity_collision` state, released Hudson's hold, and recorded `already_exists — Banner ID verified` at **2026-08-20 20:08:25 UTC**. The signed AD snapshot validated the enabled account at **20:09:16 UTC**; at **20:19:51 UTC** the worker had no error, the pending queue was empty, and Hudson was absent from the hold file.

The signed-in report refresh at **August 20, 2026, 3:17:41 PM Central** still showed **250 AD/Entra identities, 250 active Google accounts, 250 verified AD mail mappings, and 250 exact GOAEMAL rows found and preferred**, with **0 missing or needing review**. Those counts remain the current-inventory checkpoint. Hudson's pre-start recovery is retained in the activity history rather than used to inflate that inventory.

## Immutable identity and duplicate-name protection

Kylie Jo Ann Noland (`800190749`) was verified as one person and one current account across Banner, on-premises AD, Entra, and Google Workspace. `Jo Ann` is her Banner middle name, not a second student. The current AD and synchronized Entra records resolve to one immutable directory object, and the Google student account carries the same Banner identity. No second active account was created or merged into Kylie's identity.

At deployment verification, the new worker built a **6,547-entry Entra delta identity index** keyed by the immutable Microsoft Graph object ID. Multiple delta changes for the same object are collapsed before matching. Two different objects claiming the same Banner ID are quarantined instead of allowing the last record returned by Graph to win.

Google matching now follows the same identity-first rule. The worker will not adopt or tag an untagged Google account from a name match alone. A conflicting Banner marker, primary address, or alias owner is quarantined for reviewed correction. A newly discovered Entra identity can therefore wait one additional two-minute worker cycle while the identity index settles; that small delay is an intentional safety control, not a provisioning failure.

Both `waiting_for_entra` and `identity_collision` holds are now revisited by the recurring guarded hold processor. A hold clears only after exact Banner/EID, Entra, Google address, and **SCCC Banner ID** marker ownership checks succeed; otherwise it remains quarantined without blocking another student.

The signed AD snapshot also checks the complete StudentPopulation inventory for duplicate Banner ID, EID, UPN, `sAMAccountName`, and mail values. Every object involved in a collision is marked for review, and the health monitor sends a critical, de-duplicated collision alert to IT. Existing legacy identifier conflicts found by this guard remain quarantined and pending explicit approval; the guard did not rewrite any user object.

## AD name and student-identifier placement

The Banner `800######` number is an account-matching value, not part of the student's AD object name. The enforced StudentPopulation contract is:

| AD field | Required value |
|---|---|
| Name / common name (`cn`) | Banner/EUP formatted student name only; no parenthetical or bracketed 800 number |
| Display name | Banner/EUP formatted student name |
| Description | Banner `800######` number |
| `extensionAttribute2` | Banner `800######` number |
| `extensionAttribute1` | Banner-generated EID |
| `employeeID` / `employeeNumber` | Blank for this student-provisioning contract |

The Production AgentAD mapping already sources `cn` from `personIdentity.personName.formattedName`. A full StudentPopulation audit found `employeeID` and `employeeNumber` blank throughout the 4,367-plus account inventory, confirming that neither field is the SCCC student-ID location.

The guarded `ENTRACLOUDCON` fallback was corrected to use the formatted student name for the AD Name/CN and to keep the 800 number only in Description and `extensionAttribute2`. The deployed script SHA-256 is `b08bb39981f62dbbe4d72bc38d983e7643754167ac683e6b2a0a0aeebe467970`; a fresh scheduled-task run completed at **2026-08-20 20:35:35 UTC** with result `0`.

Kylie Jo Ann Noland (`800190749`) was the exact canary correction. Only her AD Name/CN was changed from the legacy value containing `(800190749)` to `Kylie Jo Ann Noland`; the same immutable AD object GUID was preserved, as were her UPN, `sAMAccountName`, mail, Description, `extensionAttribute1`, and `extensionAttribute2`. The audit found 143 other legacy StudentPopulation names with an 800-number suffix. They remain unchanged pending explicit bulk approval. The separate Christina naming anomaly was not included in this CN-only correction.

## Current Banner identity verification

| Verified result | Count |
|---|---:|
| Displayed non-staff accounts in the expanded accepted-student union | 251 |
| Banner Third Party IDs verified | 251 |
| Exact active `STD` address is preferred in GOAEMAL | 251 |
| Exact address present but not preferred | 0 |
| Quarantined identity/address ambiguity | 0 |
| Banner API/read-back errors | 0 |

The earlier report proved that a matching `@g.sccc.edu` row existed, but address presence alone did **not** prove that Banner had marked that row preferred. The August 20 exact audit initially found 94 preferred addresses among 218 verified students. The controlled catch-up promoted only the exact active `STD` row whose Banner ID, person ID, and canonical student address all matched; its first permanent-cycle checkpoint finished at **225 of 225 preferred** under the then-current cohort.

The verifier now checks the union of the recent Entra cohort and every current accepted-monitor record instead of limiting Banner read-back to recent Google activity. The Production checkpoint generated at **2026-08-20 18:33 UTC** verified **250 of 250** Banner identities, **250 of 250** Third Party IDs, and **250 of 250** exact active preferred `STD` GOAEMAL rows, with **0** current review items.

That expanded check found nine older accepted students whose exact active `STD` address existed but was not preferred. The guarded reconciler changed only the preferred flags for those nine exact Banner/person/address matches and read all nine back successfully. No email address, username, PIN, password, or user object was created or changed.

Josue Constantino Escamilla Garcia (`800201765`) is now fully verified. His complete AD UPN and Google address are `josueconstantino.escamillagarcia`; GOAEMAL contains that complete address as the sole active preferred `STD` row. His authoritative live Banner/Canvas login and Entra `mailNickname` are `josueconstantino.esc`, and successful Production Canvas sign-ins prove that this intentional difference from UPN is correct. Daniel Forero Virviescas (`800200264`) has the authoritative live Banner/Canvas login `daniel.forerovirviescas`; his existing Google object and Banner email identity are correct, but the separate Entra `mailNickname` still reads `daniel.forero` and requires an exact approved correction at the on-premises AD source.

The permanent five-minute GOAEMAL reconciler uses that corrected process. It excludes staff and quarantines any missing, duplicate, or ambiguous identity. When another address is preferred, it first demotes that exact row, promotes the verified student `STD` row, and then reads the result back. If promotion or verification fails, it restores the former preferred row. It never changes an address, person identity, username, or PIN merely to make a report pass.

The Third Party ID is the live Ethos Person `bannerUserName`, matched by immutable Banner identity evidence. It is also the Canvas login and the required AD/Entra `mailNickname`; it is never inferred from UPN, email, name, or `sAMAccountName`. Its separate five-minute job is read-only: it uses the expanded accepted-student union, excludes staff, performs collision and immutable-ID checks, and reads the current value from Banner without sending PIN data or changing GOATPAD. A Third Party ID change requires explicit approval for one exact account and a separate one-account correction tool. The live report carries the current checkpoint; the count above records the completed August 20 verification, not a promise that the cohort can never grow.

## Canvas SAML mail-nickname finding

The active primary Canvas enterprise application sends Entra `user.mailnickname` as the SAML `NameID`, and Canvas requires an exact match to its login `unique_id`. A live exact-ID audit of the current cohort found two actionable mismatches: Daniel Forero Virviescas (`800200264`, Entra `daniel.forero`, expected `daniel.forerovirviescas`) and Nancy Herrera Diaz (`800189874`, Entra typo `nanay.herreradiaz`, expected `nancy.herreradiaz`). Josue and Leonardo Sapelli Barbosa are aligned and must not be changed merely because their UPNs are formatted differently.

The on-premises AD `mailNickname` source is currently blank on the pre-feature current cohort even though Entra retained generated or previously edited alias values. The corrected guarded policy has been prepared to obtain the verified live Banner `bannerUserName`, write it only for identities created after a recorded cutover, read the same AD object back, and let the existing Cloud Sync `Alias ← [mailNickname]` mapping carry it to Entra. The report comparison and authoritative Banner verifier are active; the ENTRACLOUDCON script/task replacement is **pending the corporate VPN/admin deployment channel**, so automatic future-user `mailNickname` enforcement must not yet be claimed. Legacy users remain read-only until an exact correction is approved; there is no blanket UPN-derived rewrite.

The complete StudentPopulation inventory currently contains 4,367 accounts: **4,231 validated** and **136 needing review**, including legacy contract discrepancies outside the current report cohort and the identifier collisions now exposed by the global uniqueness guard. The current cohort's 251 core provisioning/email records and Banner credentials are verified; the separate Canvas SAML alias control has two exact legacy findings pending scoped approval. The legacy records were not bulk-modified and require a separately approved cleanup project.

## Enforced production sequence

`Banner accepted/current-term decision → Ethos/EUP primary AD creation → guarded missed-account recovery → Entra Cloud Sync → two-minute Entra validation/licensing → Google Workspace → EUP report`

The recovery and downstream controls now provide:

- independent two-minute accepted/current-term decision checks, even when EUP events do not reach the Ethos message queue;
- a ten-minute grace period for normal EUP processing;
- per-student isolation, collision checks, and a hard employee/StudentPopulation boundary;
- immutable-object Entra delta indexing that collapses repeated changes and quarantines different objects claiming the same Banner ID;
- exact Banner/Ethos AD and Google identity values instead of guessed usernames;
- Microsoft 365 A1 Student assignment with Exchange disabled before Google access;
- two-minute Cloud Sync heartbeat and worker health checks;
- deduplicated incident and recovery email to `itech@sccc.edu` and `mark.bojeun@sccc.edu`;
- a five-minute signed, read-only AD verification snapshot;
- global duplicate detection for Banner ID, EID, UPN, `sAMAccountName`, and mail, with critical collision alerts to IT;
- a 30-minute read-only Google verification refresh that applies staff and eligibility guards before account checks, so the report and recovery ledger do not depend on a stale manual export;
- five-minute exact GOAEMAL preference reconciliation plus read-only Banner Third Party ID verification, with read-back, rollback where applicable, and quarantine safeguards;
- recurring guarded retry of both Entra-wait and Google identity-collision holds after their underlying evidence changes;
- an activity view grouped by Banner 800 number that displays the 800 number and the latest outcome for each student instead of presenting retry substeps as separate students;
- an explicit prohibition on unapproved bulk correction of existing users.

The August 20 worker deployment also restored and revalidated the Banner verification, Banner email backstop, GOAEMAL audit/fix, GOAEMAL reconciliation, and Google verification scripts before their systemd timers were returned to active service. A worker binary replacement must not silently remove those adjacent operational controls.

## Staff/student identity boundary

The worker now resolves an existing identity by exact Banner 800 number and EID before it considers a derived username. An exact account outside `OU=StudentPopulation` is classified as staff and excluded before student licensing, Google creation, GOAEMAL reconciliation, or student-report inclusion. A conflicting identity inside StudentPopulation is quarantined instead of rewritten.

This corrected Patty Volden (`800012073`) without changing her account. Her verified staff identity remains `patty.volden@sccc.edu` with staff/faculty groups, the faculty Microsoft 365 license, and Exchange. No student license or Google student account was created.

## ACR recovery ledger

Production ACR now holds a sanitized, append-only recovery ledger of accepted Ellucian applications and decisions plus exact verified Banner, AD, Entra, Google, EUP, staff-exclusion, and eligibility-hold evidence. The first committed baseline contains **123,497** records across **9** sources; snapshot `94f5aad6-562a-4afb-a347-909c007d0d43` has manifest SHA-256 `91e573c656043061bd4b08ecb9288ebce8c57a9c0e0260c71289f233d60ad9ac`.

After the final identity corrections, a second complete snapshot committed at **2026-08-20 18:48:16 UTC**. Snapshot `52517fdf-e533-4020-9ac6-8686ae99fa23` contains **123,556** sanitized records across **9** sources and has manifest SHA-256 `3900a598095dbec36c293939d4603e57b1a95e4591c7cde8664cc59c60d1a4b7`. It includes the completed **250 of 250** Banner identity and Third Party checkpoints; it does not rewrite the immutable first baseline.

The snapshot runs daily at 3:30 AM Central and never writes a user account. It is recovery evidence, not a replacement Banner and not authorization for bulk recovery. Encrypted off-host export is still pending an IT-supplied `age` public recipient and approved destination, so the current ledger does not by itself protect against total loss of `app-server2`.

## Canvas communication-address boundary

AD, GOAEMAL, and Google identity correction does not automatically rewrite an existing Canvas communication channel. Jorge Frias (`800201754`) has the correct Canvas SIS ID, institutional login, and six active enrollments, but his Canvas primary email remains the older `jfrias@g.sccc.edu`. That isolated Canvas address requires an exact Canvas correction; the Canvas user ID, SIS ID, login, and enrollments must be preserved. It is not evidence that EUP failed to create his directory account.

Rebekah Hall (`800201799`) was corrected through that exact-object process. Canvas user `20139` already had the correct SIS ID `800201799`, active login pseudonym `35233` with unique login `rebekah.hall`, and primary communication channel `24102` at `rebekah.hall@g.sccc.edu`. Duplicate searches by Banner ID, name, current login, and the obsolete `rhall5` value found no second Canvas user. Only stale channel `24095` (`rhall5@g.sccc.edu`) was retired; the Canvas user, SIS ID, login, and primary channel were unchanged.

The same immutable AD object (`037707bd-35fd-4bff-afde-3b5588a4fdf9`) was retained while its legacy Name/CN was cleaned from `Rebekah Hall (800201799)` to `Rebekah Hall`. UPN `rebekah.hall@sccc.edu`, mail `rebekah.hall@g.sccc.edu`, `sAMAccountName`, Banner ID/EID attributes, required groups, and object identity were preserved. Canvas currently reports zero enrollments for this user. Courses require an official Banner registration and the separately owned Canvas enrollment integration; IT must not manufacture a manual enrollment to make the account appear complete. The current publisher and schedule of that integration are still being verified.

The exact before/after evidence is stored at `C:\Users\mark.bojeun\Documents\ChatGPT\Banner\rebekah-canvas-correction-evidence-20260820.json` with SHA-256 `2887b5c824ad6cb2ea7112d8cc61289aa059228b81da2a26a2788c0785393bb2`.

## Identity accuracy correction

The student AD UPN and Google address use the same Banner/Ethos canonical local part: `firstname.lastname@g.sccc.edu` becomes `firstname.lastname@sccc.edu`, including any Banner-selected numeric collision suffix. A staff-style first-initial value is not a valid fallback for a student AD login.

AD's legacy `sAMAccountName` field is limited to 20 characters, so only that legacy field is shortened for long names; the complete canonical UPN remains the student's Microsoft sign-in.

After explicit approval, 10 identified StudentPopulation accounts were corrected. Only their UPN and `sAMAccountName` changed. Passwords, object identity, enabled state, OU, Banner attributes, Google address, required groups, and student licensing were preserved. The final live report showed all 10 as **AD and Google verified** and **0 need review**.

## Safety boundary

The scheduled recovery may create one genuinely missing accepted/current-term student. It verifies an existing account but does not rewrite it by default. Existing-user correction requires an administrator to deliberately invoke `-AllowExistingUserCorrection` after an approved, reviewed change. No legacy bulk correction is part of this solution.

The IT Hub Banner route still uses the existing Microsoft/IT-team access gate, and its three documents are now also returned only by an authenticated server API. They are no longer embedded in the anonymously downloadable SPA JavaScript bundle. Unauthenticated document requests return HTTP 401 and authenticated responses are marked private/no-store.

## Operational conclusion

Maria's normal role is verification, not account creation. The Windows tasks, Linux services, report, and IT alerts run without a recurring Codex session. An administrator is needed only for a quarantined exception, an approved configuration change, or an explicitly authorized bulk cleanup.
