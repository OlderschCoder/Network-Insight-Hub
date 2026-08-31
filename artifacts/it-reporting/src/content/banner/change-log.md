# EUP Provisioning Full Change Log

**Coverage:** Foundation through the targeted Production identity-collision cleanup on August 21, 2026
**Systems:** Banner, Ellucian Ethos/EUP, AgentAD, Active Directory, Microsoft Entra, Google Workspace, Canvas, ACR PostgreSQL, and SCCC reporting

## August 31, 2026 — canonical student identity authority correction

- Corrected the authority order so the EUP-generated preferred student email drives GOATPAD Third Party ID, AD/Entra `mailNickname`, and the Canvas login.
- Removed the assumption that an existing Ethos `bannerUserName` is automatically canonical; first-initial legacy values are now reported as still processing or approval-required.
- Added exact Banner ID, person UUID, EID/UDC, preferred-email, uniqueness, and 30-character guards before a supported Third Party ID write.
- Limited automatic GOATPAD and AD alias changes to identities first seen after immutable deployment cutovers. Existing students are never bulk-changed.
- Confirmed Canvas SAML JIT is disabled. Duplicate-looking recent records were multiple communication channels on one SIS user, not multiple Canvas users; cleanup remains per-user and approval-controlled.
- Deployed the future-only GOATPAD synchronizer on `app-server2` and the matching two-minute AD alias policy on `ENTRACLOUDCON`; both use immutable August 31 cutovers and leave every earlier account approval-only.
- Rebuilt the protected Production report so a pending canonical Third Party ID appears as **Still processing** instead of a false error.
- Corrected the AD JSONL writer to allow simultaneous report reads, eliminating a file-lock race that could mark an otherwise normal scheduled run failed.
- The completed AD validation cycle reported **94 verified**, **1 still processing**, **2 existing approval-only**, **0 errors**, **0 created**, and **0 corrected**. No bulk user update was performed.
- The Production GOATPAD cycle changed **0** existing identities and **0** PINs. A newly observed record without exact preferred-email proof remains quarantined independently and does not block later students.

## August 21, 2026 — targeted Banner ID and EID collision cleanup

- Reviewed the nine reported Banner-ID collision groups and the reported Banner-EID collision by immutable Banner person UUID, Banner 800 number, Banner EID/UDC, AD object GUID, Entra object ID, UPN, Description, and current directory location. A person's name was used only for display; a former or changed name did not establish account ownership.
- Confirmed that Tara Thompson and Laura Rodriguez Esquivel are single Banner people whose current AD objects already carried their correct Banner ID and EID. Their name histories were not duplicate identities; unrelated staff objects had inherited the same `extensionAttribute2` values.
- Corrected 19 exact AD objects whose `extensionAttribute2` did not equal that object's own Banner-backed Description. The correction changed only the stale identity marker on the same immutable object. Usernames, mail values, names, enablement, groups, licenses, and passwords were not changed.
- Corrected two additional proven EID-source defects within that same guarded set: LaDanity Timmons received her Banner EID `547BCD4A81734C92A40FFC424CC91D1C`, and Maricruz Haines received her Banner EID `889B10C84AD747E7A8444A2955A27E20`. Ciro Rodriguez Puig remained blank because his live Banner profile does not currently supply a UDC/EID; the process did not manufacture one.
- Completed the two partially corrected cases: Tevin Cotter now carries Banner ID `800200685` in both Description and `extensionAttribute2`, and Benjamin Born now carries Banner ID `800198715` in both fields. Devaney Carter and Cesar Alba retained their own distinct Banner IDs. Jesus Moreno and Jocelyn Shuck were read back with separate, correct EIDs.
- Identified `Estesfany Sanchez` and `Felipe Payan` as Entra-only orphan objects. Each Entra immutable ID decoded to a specific AD object already present in the AD Recycle Bin; neither orphan had a successful Entra sign-in. The legitimate Estefany Sanchez and Lidice Martinez Rodriguez objects were separately verified by Banner ID, EID, active AD object, and Entra object.
- Soft-deleted only those two exact Entra orphan objects and verified them in Entra Deleted Users. They remain recoverable during Microsoft's deleted-user retention period; no active source account was deleted.
- After Cloud Sync and the two-minute Entra delta refresh, all nine reported Banner IDs resolved to exactly one indexed Entra owner and the Jocelyn/Jesus EIDs each resolved to exactly one owner. This was a scoped correction of the reported identities, not a bulk directory rewrite.

## August 20, 2026 — Canvas SAML NameID and mail-nickname contract

- Proved from the active Production configuration that the primary Canvas SAML provider uses Entra `user.mailnickname` as `NameID`, does not strip a domain, and requires an exact existing Canvas login because just-in-time creation is disabled.
- Proved that Canvas login `unique_id` equals the live Ethos Person `credentials[type=bannerUserName]` value for Daniel Forero Virviescas, Josue Constantino Escamilla Garcia, Nancy Herrera Diaz, and Leonardo Sapelli Barbosa.
- Rejected the tempting but unsafe rules “use UPN local part” and “use `sAMAccountName`.” Daniel requires a value longer than the 20-character `sAMAccountName`, while Josue's correct Banner/Canvas login is intentionally shorter than his complete UPN.
- Added the exact Entra mail-nickname value and Banner/Canvas comparison to the Production report contract. Missing or different values are now distinct actionable identity findings rather than generic Canvas errors.
- Updated the guarded AD recovery design to source `mailNickname` only from the verified Banner credential after exact Banner ID, person UUID, and EID/UDC agreement; missing or ambiguous credentials fail closed.
- Prepared and validated the replacement reconciliation and snapshot scripts, but did **not** replace the live ENTRACLOUDCON tasks because the corporate VPN/admin channel was unavailable. The report comparison, authoritative Banner verifier, and read-only Third Party verifier are active; automatic future-user AD `mailNickname` enforcement remains pending, and no live Windows script or user account was changed by the failed-closed attempts.
- Kept all pre-feature AD nickname gaps and legacy Entra aliases read-only. The exact existing Daniel and Nancy source corrections remain pending scoped approval; no bulk account update was authorized or performed.
- Recorded the duplicate active SAML provider as a configuration risk: the legacy provider uses UPN with domain stripping and must not be used to conceal a broken primary-provider identity.

## August 20, 2026 — 251st-student automatic catch-up verification

- Observed Cruz Moradelizarraga (`800201815`) enter the live cohort while a legacy `STD` address was still preferred. The canonical address already matched AD, Entra, and the exact active Google account.
- Confirmed the first preference audit failed closed because it raced the new cohort refresh; it did not adopt the legacy value or block later processing.
- The normal five-minute GOAEMAL reconciler selected only the exact Banner ID/person ID/canonical address, demoted the prior preferred row, promoted the canonical row, and verified the supported API responses by read-back. No manual or bulk user write was performed.
- Final Production evidence for the core provisioning/email contract showed **251 of 251** exact Banner identities, preferred GOAEMAL addresses, Third Party IDs, AD/Entra object matches, Google accounts, and student mail mappings verified. The later Canvas SAML alias control is reported separately and found two exact legacy `mailNickname` mismatches pending scoped approval; no bulk correction was authorized.

## August 20, 2026 — Protected system architecture and access handbook

- Added a fourth **System Architecture & Access** document to the authenticated IT Insights Hub Banner page.
- Documented the complete entity model and authoritative ownership for Banner people, applications, decisions, EUP identity profiles, GOAEMAL, GOATPAD, AD, Entra, Google, official registrations, Canvas, operational holds/audit, and ACR recovery snapshots.
- Added interactive, view-only diagrams for the end-to-end data flow, immutable-identity relationships, and Production deployment/access boundaries. Diagram content is loaded only after authenticated API access and is not embedded in the public SPA bundle.
- Recorded the exact Production systems, services, scheduled tasks, file/state locations, and current cadences on Ellucian SaaS, `app-server2`, `ENTRACLOUDCON`, and `AD-SC00` through `AD-SC03`.
- Recorded access methods and secret **references** without exposing passwords, API-key values, service-account key bodies, private keys, or session tokens.
- Made the identity hierarchy explicit: platform immutable IDs first, Banner 800/EID second, and mutable usernames/emails only after exact-object collision checks. Names alone never establish identity.
- Preserved the standing controls that staff are excluded before student actions, account provisioning cannot manufacture enrollment, one quarantined student cannot block the queue, and no bulk user write is permitted without explicit scoped approval.

## August 20, 2026 — Rebekah Hall exact AD and Canvas correction

- Verified Rebekah Hall as Banner student `800201799` and exactly one Canvas user, ID `20139`. Canvas login pseudonym `35233` already had active unique login `rebekah.hall` and SIS ID `800201799`; searches by Banner ID, name, `rebekah.hall`, and `rhall5` found no duplicate Canvas user.
- Preserved primary Canvas communication channel `24102`, `rebekah.hall@g.sccc.edu`. Retired only stale channel `24095`, `rhall5@g.sccc.edu`; no Canvas user, login, SIS ID, primary address, or enrollment was changed.
- Confirmed Canvas currently reports zero enrollments for Rebekah. Any course membership requires an official Banner registration and the separately owned Canvas enrollment integration, not a manual identity repair. A later Production audit confirmed ACR's Canvas roster job is read-only and that the current enrollment publisher/location/schedule still requires verification.
- Cleaned the existing AD object's Name/CN from `Rebekah Hall (800201799)` to `Rebekah Hall` while retaining immutable object GUID `037707bd-35fd-4bff-afde-3b5588a4fdf9`, UPN `rebekah.hall@sccc.edu`, mail `rebekah.hall@g.sccc.edu`, `sAMAccountName`, Description, Banner ID/EID extension attributes, and required student groups.
- Stored the exact Canvas before/after audit at `C:\Users\mark.bojeun\Documents\ChatGPT\Banner\rebekah-canvas-correction-evidence-20260820.json`, SHA-256 `2887b5c824ad6cb2ea7112d8cc61289aa059228b81da2a26a2788c0785393bb2`. The guarded correction tool SHA-256 is `8d8352ee5fcd7660b931b441da73ffd22855b68cb5e48302e118d2338458d455`; the exact AD Name/CN correction script SHA-256 is `892cf1bb974aa89d70e01d7648e682576941d43809b2e04524b784f3310b5981`.

## August 20, 2026 — AD Name/CN and student-identifier placement correction

- Confirmed the SCCC StudentPopulation field contract: the Banner 800 number belongs only in AD Description and `extensionAttribute2`; the Banner-generated EID belongs in `extensionAttribute1`; `employeeID` and `employeeNumber` remain blank.
- Audited the 4,367-plus StudentPopulation inventory and found no populated `employeeID` or `employeeNumber` values, confirming those are not the student-ID fields used by this provisioning solution.
- Confirmed the Production AgentAD Student mapping sources `cn` from `personIdentity.personName.formattedName`, so a new EUP-created AD object's Name/CN is the formatted student name without an 800-number suffix.
- Patched the independent `ENTRACLOUDCON` recovery fallback to use the same clean Name/CN rule while retaining the 800 number in Description and `extensionAttribute2`. Deployed SHA-256 `b08bb39981f62dbbe4d72bc38d983e7643754167ac683e6b2a0a0aeebe467970`; a fresh `SCCC-EUP-AD-Reconciliation` run completed at `2026-08-20 20:35:35 UTC` with result `0`.
- Corrected only Kylie Jo Ann Noland (`800190749`) as the exact canary: renamed the existing AD Name/CN from its legacy value containing `(800190749)` to `Kylie Jo Ann Noland`, preserving the same immutable GUID, UPN, `sAMAccountName`, mail, Description, and extension attributes.
- Found 143 additional legacy StudentPopulation CN values with parenthetical or bracketed 800-number suffixes. Left all 143 unchanged because a bulk rename requires explicit approval.
- Kept the separate Christina naming anomaly outside this CN-only correction for individual review.

## August 20, 2026 — Hudson Horn exact recovery and recurring hold repair

- Resolved Hudson Horn (`800201698`) as one existing pre-report-start student identity; the resolution does not increase the current-inventory count.
- Verified exactly one StudentPopulation AD object by Banner ID `800201698` and EID `0F61942AF61D432F9E7692D391345FE1`. Its immutable object identity, `hudson.horn@sccc.edu` UPN, `hudson.horn@g.sccc.edu` mail, and Banner attributes already matched; enabled only that exact disabled object and read the same object back as enabled.
- Verified the existing active Google object has exactly one custom `externalIds` entry named **SCCC Banner ID** with value `800201698`, and that the marker-owner search resolves only to `hudson.horn@g.sccc.edu`. No Google account was created, renamed, merged, or adopted by name.
- Extended the recurring guarded hold processor to retry `identity_collision` as well as `waiting_for_entra`. An identity collision remains isolated until exact ownership evidence passes; a cleared student no longer requires a one-off worker run.
- Verified the final lifecycle: worker audit `already_exists — Banner ID verified` at `2026-08-20 20:08:25 UTC`; signed AD snapshot enabled/validated at `20:09:16 UTC`; worker healthy with no error, zero pending, and no Hudson hold at `20:19:51 UTC`.
- Restored the Banner verification, Banner email backstop, GOAEMAL audit/fix, GOAEMAL reconciliation, and Google verification scripts after the worker deployment, ran each associated service successfully, and returned every related systemd timer to enabled/active state.
- Changed Automation activity to group student actions by Banner 800 number, display the 800 number in the activity table, and show the most recent result for that identity. Retries and verification substeps no longer look like separate outstanding students.
- Rechecked the signed-in report at `August 20, 2026 3:17:41 PM Central`: **250 AD/Entra**, **250 active Google**, **250 verified AD mappings**, **250 GOAEMAL found/preferred**, and **0 missing or needing review**. Hudson remains in resolved activity history because his identity predates the current inventory start.
- Kept global legacy collisions in their separate quarantined history. This exact Hudson correction did not authorize or perform a bulk rewrite of those historical objects.

## August 20, 2026 — Immutable identity and duplicate-account guard

- Verified Kylie Jo Ann Noland (`800190749`) as one Banner person, one current on-premises AD object, one synchronized Entra object, and one Google student account. `Jo Ann` is the student's Banner middle name; no second active identity was created or merged.
- Deployed a worker identity index that contained 6,547 Entra entries at verification and is keyed by immutable Microsoft Graph object ID rather than display name.
- Collapsed multiple Entra delta changes for the same object before matching, so routine change events cannot be mistaken for multiple people.
- Replaced the previous duplicate-Banner-ID last-record selection with quarantine when different Entra objects claim the same Banner 800 number.
- Removed Google name-only adoption and untagged-account tagging. Existing Google accounts now require immutable identity evidence; conflicting primary addresses, aliases, or Banner ID marker owners are quarantined.
- Accepted one additional two-minute worker cycle for a newly discovered Entra identity so the immutable index can settle before Google processing.
- Extended the signed AD snapshot to detect duplicate Banner ID, EID, UPN, `sAMAccountName`, and mail values across the full StudentPopulation inventory and mark every involved object for review.
- Added de-duplicated critical health email for directory identity collisions.
- Left the legacy Banner ID, EID, and `extensionAttribute2` conflicts discovered by the new guard quarantined and unchanged. Their exact corrections are pending explicit approval; no bulk user modification was performed.

## August 20, 2026 — Staff identity-first classification

- Diagnosed Patty Volden (`800012073`) as staff, not a student. Her exact Banner ID/EID match resolves to `patty.volden@sccc.edu` outside StudentPopulation with staff/faculty groups, the faculty Microsoft 365 license, and Exchange.
- Corrected the worker to search existing identities by exact Banner 800 number and EID before comparing a derived username. This prevents a formal Banner first name from hiding a nickname-based staff account.
- Added a hard pre-provisioning boundary: an exact identity outside StudentPopulation is persisted as a staff exclusion before student licensing, Google creation, GOAEMAL reconciliation, or student-report inclusion.
- Quarantined conflicting StudentPopulation identities rather than guessing which username is correct.
- Verified that Patty's existing staff account was preserved and that no student license, student groups, or Google student account was created.

## August 20, 2026 — ACR append-only recovery ledger

- Installed the sanitized recovery ledger in Production ACR PostgreSQL with immutable history tables, per-source and per-record SHA-256 hashes, explicit sensitive-field denial, and last-good views that cannot advance on a failed or partial collection.
- Used a dedicated least-privilege database login and the existing protected Ellucian key through restricted read access; no credential copy was created.
- Committed the first Production baseline at `2026-08-20 17:38:10.851108+00`: snapshot `94f5aad6-562a-4afb-a347-909c007d0d43`, manifest SHA-256 `91e573c656043061bd4b08ecb9288ebce8c57a9c0e0260c71289f233d60ad9ac`, **123,497** sanitized records across **9** sources.
- Preserved **53,486** accepted applications and **64,973** accepted decisions, plus verified Banner, AD, Entra/Google, EUP, staff-exclusion, and eligibility-hold evidence. Incomplete historical Ellucian relationships remain unresolved evidence and never become inferred identities.
- Enabled the daily 3:30 AM Central snapshot timer. The ledger is recovery evidence only and cannot create or bulk-modify users.
- Left encrypted off-host export disabled pending an IT-provided `age` public recipient and approved destination/retention policy. Until that is configured, the ledger does not protect against total loss of `app-server2` and its ACR database.
- Committed a second, post-correction Production snapshot at `2026-08-20 18:48:16.838456+00`: snapshot `52517fdf-e533-4020-9ac6-8686ae99fa23`, manifest SHA-256 `3900a598095dbec36c293939d4603e57b1a95e4591c7cde8664cc59c60d1a4b7`, **123,556** sanitized records across **9** sources. It includes **250** verified Banner identities and **250** verified Third Party IDs while preserving the immutable first baseline.

## August 20, 2026 — Completed expanded Banner identity checkpoint

- Replaced the stale manual Google source with a read-only verification service that runs every 30 minutes and feeds current evidence to reporting and later ACR snapshots without changing Google users.
- Added explicit staff-exclusion and eligibility-hold guards to the Google verifier before any account check. The completed run verified **225 active Google accounts**, excluded **5** guarded candidate records, and reported **0** missing accounts and **0** items needing review.
- Expanded Banner verification from the recent Entra/Google cohort to the union of that cohort and every current accepted-monitor record, while retaining exact Banner ID, person ID, AD, staff, and eligibility guards.
- The expanded check found nine older accepted students whose exact active `STD` row existed but was not preferred. The guarded reconciler promoted only those nine exact rows and verified all nine by read-back. No address, username, PIN, password, or user object was changed.
- The nine exact preferred-flag corrections were Nancy Herrera Diaz (`800189874`), Gael Ruvalcaba (`800190394`), Jonathan Mendez (`800191721`), Marisol Guaderrama (`800192878`), Lauren Rodriguez (`800193112`), Juliauna Van Wyhe (`800193318`), Alberto Sanchez (`800194234`), Ashley Vizcarra (`800197855`), and Bianca Vera (`800201359`).
- Updated the Third Party reconciler to use the same expanded accepted-student union instead of requiring a recent Google-verification row. The completed Production run verified **250 of 250** Third Party IDs with **0** blocked lengths, **0** collisions, and **0** failures.
- Completed the combined Production checkpoint at `2026-08-20 18:33 UTC`: **250 of 250** Banner identities verified, **250 of 250** exact active `STD` rows preferred, **0** preference errors, and **0** current review items.

## August 20, 2026 — Josue and Daniel exact-identity corrections

- Corrected Josue Constantino Escamilla Garcia (`800201765`) on the existing immutable AD/Entra identity. His complete UPN and Google/GOAEMAL address are `josueconstantino.escamillagarcia`; the sole active `STD` row is preferred. His Third Party ID remains the independently verified live Banner/Ethos `bannerUserName`, `josueconstantino.esc`; it is intentionally different from the complete UPN and was not derived from a length rule or `sAMAccountName`.
- Corrected Daniel Forero Virviescas (`800200264`) to `daniel.forerovirviescas` across the existing Google object, AD/Entra sign-in identity, GOAEMAL preferred row, and Third Party ID. The former Google address remains an alias; no duplicate Google or Entra object was created. The later Canvas SAML audit found his separate legacy AD/Entra `mailNickname` still required an exact scoped source correction.
- Used exact Banner ID/EID, immutable Google user ID, and one-object Cloud Sync read-back for both corrections. The accepted monitor reports Daniel provisioned and Banner credential verification reports both students verified; those facts are separate from the later mail-nickname control.

## August 20, 2026 — IT Hub Banner server-side document protection

- Found that the `/banner` route was correctly hidden by the React `ProtectedRoute`, but its imported Markdown was still compiled into an anonymously downloadable shared JavaScript asset.
- Removed the three Banner Markdown documents from the public Vite bundle and added `/api/banner/documents` behind the IT Hub's existing `requireAuth` active-session check.
- Kept the shared login shell and every other IT Hub page unchanged. No global nginx/static-asset rule was added, so the Microsoft sign-in page can still load normally.
- Marked authenticated document responses `private, no-store`, verified that an unauthenticated request returns HTTP 401, and scanned the deployed public bundle to confirm the Banner headings and named identity cases are absent.

## August 20, 2026 — Jorge Frias Canvas diagnosis

- Verified Jorge Frias (`800201754`) across Banner, AD/Entra, Google, and Canvas. His Canvas SIS ID, institutional login, and six active enrollments are correct.
- Isolated the remaining problem to Canvas's communication address: it still shows `jfrias@g.sccc.edu` instead of `jorge.frias@g.sccc.edu`.
- Documented that correcting AD, GOAEMAL, and Google does not automatically rewrite an existing Canvas communication channel. The safe correction changes only the exact Canvas primary email and preserves the Canvas user ID, SIS ID, login, courses, and enrollments.

## August 20, 2026 — Exact GOAEMAL preferred-address correction

- Corrected the report's verification definition: finding the canonical `@g.sccc.edu` address in GOAEMAL proves presence, but it does not prove Banner has marked that row preferred.
- Ran an exact Production audit across the approved displayed non-staff cohort. The first checkpoint found **94 of 218** canonical active `STD` rows preferred, with **124** present but not preferred, **0** ambiguous matches, and **0** query errors.
- Replaced the unsuccessful plural-resource write attempt with Ellucian's supported singular email-address BPAPI. The rejected plural calls changed no records.
- Proved the corrected method with a single canary before catch-up. Banner correctly required the former preferred row to be demoted before the canonical active `STD` row could be promoted.
- Implemented a guarded two-step swap: demote the exact former preferred row, promote the exact verified student row, read both results back, and restore the former row automatically if promotion or verification fails.
- Required an exact Banner ID, person ID, active `STD` address, and canonical `@g.sccc.edu` match. Staff identities, missing or duplicate matches, multiple preferred rows, and any identity ambiguity are quarantined rather than changed.
- Completed the catch-up while the cohort continued to grow. The first permanent-cycle checkpoint reached **225 of 225** canonical student rows preferred, **0** not preferred, **0** ambiguous, and **0** API/read-back errors.
- Installed the corrected logic as the permanent five-minute GOAEMAL preferred-address reconciler so new eligible students use the proven method automatically instead of repeating the earlier failure path.
- Added stale-run and real-exception health alerting to `itech@sccc.edu` and `mark.bojeun@sccc.edu`; routine timing and successful no-change cycles do not produce false failure alerts.
- Preserved the existing safety boundary: the reconciler changes only preferred flags on exactly verified rows. It does not invent or change an email address, username, person identity, PIN, employee record, or unrelated historical user.
- Updated the live verification contract so reports must distinguish **preferred** from merely **present**.

## August 19, 2026 — Banner Third Party ID correction and automatic verification

- Confirmed that GOATPAD's Third Party ID is `GOBTPAC_EXTERNAL_USER` and corrected it through Ellucian's supported `third-party-access-audit-pin-history` BPAPI, with an exact read-back after every write.
- Corrected Karen Armistead (`800201743`) from the legacy `karmiste` value to `karen.armistead`, then reconciled the explicitly approved non-staff EUP report cohort.
- Superseded the earlier UPN-derived Third Party rule after live Canvas SAML evidence proved that the authoritative value is the Ethos Person `bannerUserName`. UPN and `sAMAccountName` remain separate fields and may intentionally differ.
- Historical rule, now superseded: the original August 19 implementation used verified AD `sAMAccountName` when a UPN local part exceeded Banner's 30-character field. Josue Constantino Escamilla Garcia (`800201765`) remains `josueconstantino.esc` because that is his independently verified live Ethos `bannerUserName`, not because it was derived from UPN length or `sAMAccountName`.
- Installed `sccc-eup-third-party-id-reconcile.timer` on `app-server2` on August 19. The original implementation could write UPN/SAM-derived values; on August 20 IT stopped it, replaced the installed script with the read-only exact Banner credential verifier, verified `Mode=read_only` and `WritesBanner=false`, and only then returned the five-minute timer to enabled/active service.
- Updated the live EUP report to use recurring Banner read-back instead of stale provisioning snapshots. The August 19 checkpoint was **201 of 201**; after the August 20 accepted-union expansion and exact credential corrections, the read-only verifier reached **251 of 251** Third Party IDs with **0** current review items and no Banner writes.

## August 18, 2026 — Canonical identity and faster 800-number lookup

- Located Josue Constantino Escamilla Garcia (`800201765`) on the existing AD object identified by its matching Description and `extensionAttribute2`; no duplicate account was created.
- The August 18 checkpoint reported a full canonical AD/Entra and Banner correction after exact-object synchronization and read-back. A stricter August 20 audit exposed a remaining shortened-value inconsistency; the later August 20 exact-object correction resolved it and the complete address now reads back across AD/Entra, Google, and GOAEMAL.
- Retained the complete active Google account with the matching Banner ID throughout the correction; no duplicate account was created.
- Standardized operational AD searches to use `Description = 800######` first, with `extensionAttribute2` and StudentPopulation OU checks required before any write.
- Retained the no-bulk-change safeguard: duplicate or conflicting identity markers are quarantined for review.
- Replaced the report's misleading `Outside current admission set` Banner label with a read-only Banner/Ethos persons verification for every displayed, non-staff identity.
- Verified 118 Banner user IDs and GOAEMAL student addresses. Classified 79 additional identities as scheduled—not failed—because their Banner student role begins August 19, 2026 at 12:00 AM Central. Current read-back review count is zero.
- Added `sccc-eup-banner-verification.timer` on `app-server2` to refresh the full displayed Banner read-back every ten minutes without writing or changing Banner records.

## August 7, 2026 — Foundation

- Established the SCCC EUP provisioning and administrative-reporting work.
- Defined the intended student identity flow from Banner and Ethos through institutional directories.
- Began replacing the manual username, email, and Google-account workaround.
- Established the EUP Provisioning Report as both a stand-alone operational report and a protected IT Insight Hub resource.

## August 10, 2026 — Initial integration

- Configured Ethos message access for `user-identity-profiles`.
- Configured Google Workspace service-account access and domain-wide delegation.
- Added an administrative activity ledger and duplicate protection.
- Corrected a repeated-polling failure caused by duplicated HTTP authorization headers.
- Began displaying message, identity, and processing results for IT staff.

## August 11, 2026 — Environment and reporting correction

- Determined that the initial worker and report were using the wrong Ethos key/environment context.
- Stopped the continuous Google worker before treating the earlier counts as Production facts.
- Withdrew the earlier claims that 294 Production Google accounts had been reviewed and 292 had been deleted. Those numbers were not a valid Production cohort and are not used in the corrected report.
- Installed and validated the Production Ethos key for tenant alias `scccats`.
- Rebuilt the report from correct Production identity data.
- Corrected the page layout so the existing student account inventory appears before issues and technical activity.
- Removed Student Access navigation chrome from the EUP report so it remains an IT administrative report rather than a student-facing page.

## August 11–12, 2026 — Production cohort reconciliation

- Reconciled 23 current AD/Entra student identities against Google Workspace.
- Confirmed 19 existing active Google accounts.
- Created four missing Google accounts in a controlled apply run.
- Rechecked the completed cohort and confirmed 23 active Google accounts for 23 identities.
- Verified AD `mail` directly: 21 student records use their `@g.sccc.edu` address.
- Documented two dual-role exceptions, James Tower and Lyle Stickney, whose employee-oriented AD placement and `@sccc.edu` mail values are retained while their student Google accounts remain active.
- Rebuilt the live EUP report to show the actual AD mail, Google account, Google status, and directory outcome.

## August 12, 2026 — New-account Google identity marker

- Added the Banner 800 number to every Google account newly created by the continuous worker.
- The marker is stored as the custom Google external ID **SCCC Banner ID**.
- Tagged the four accounts created during the controlled reconciliation and verified the tagging operation was idempotent.
- Explicitly excluded the approximately 4,000 legacy student Google accounts from bulk backfill.
- Added safe legacy matching: an untagged exact address is accepted only when the Google name matches the incoming student.
- Added collision protection: a different Banner ID or mismatched legacy name is quarantined and never overwritten.

## August 12, 2026 — Nonblocking reliability controls

- Removed the frozen current-term snapshot from the continuous creation path. It was not refreshed by any scheduled job and could have permanently skipped a valid new student.
- Made the Production EUP student identity profile the authoritative provisioning trigger, with the valid `800######` format and student role as safeguards.
- Kept Entra as the hard prerequisite for Google creation.
- Replaced the single blocking cursor behavior with a durable per-student pending queue.
- A student waiting for Entra is now quarantined and retried independently every two minutes while later messages continue.
- A retry failure is isolated to that student and cannot terminate the polling cycle or block later accounts.
- Repeated identical pending errors are de-duplicated in the audit ledger to avoid alert noise.

## August 12, 2026 — Production activation

- Archived the former Test-key cursor and audit files rather than mixing them with Production history.
- Established a fresh Production cutover at `2026-08-13 04:15:22 UTC` (`August 12, 2026 11:15:22 PM` Central Daylight Time).
- Enabled the Production worker for new messages only.
- Enabled Google account creation after the Entra-first control.
- Set the polling interval to two minutes.
- Confirmed Production Ethos authentication, Google delegated-administrator access, active/enabled service state, a current successful poll, no worker error, and an empty pending queue at activation.

## August 12, 2026 — Documentation and visibility

- Replaced the Banner page's stale report with the correct Production architecture and verified counts.
- Rewrote Maria's document as an **Operating Procedure** centered on verification and exception reporting.
- Documented the new-account-only Banner ID marker and the legacy-account safety policy.
- Updated this full change log with both the incorrect earlier report and its correction, rather than silently erasing the history.
- Retained the live EUP Provisioning Report as a separate protected operational view.

## August 13, 2026 — Production EUP permission and mapping correction

- Found that the Production AD identity provider and Student role were enabled, but the global EUP **Create** and **Update** operations were both off.
- Enabled and saved both operations, then reloaded Production EUP and verified that both remained enabled.
- Added `description ← bannerId` to the Student AgentAD field mapping, saved it, reloaded the configuration, and verified that it persisted.
- Reverified the four explicit Student role assignments: `StudentsAll`, `StudentWireless`, `portalStudents`, and `portalUsers`. `Domain Users` remains the inherited primary group and is not redundantly assigned.
- Defined the required new-student organization fields as `Department=Student` and `Company=SCCC`.
- Added a scoped two-minute AD guardrail for new EUP students because Ellucian EUP does not offer a literal/constant source value for those two fields. The guardrail also enforces the 800-number description and required explicit groups.
- Kept the report honest: the Production configuration is corrected, but the first eligible post-change student must complete the full path before it is labeled proven end to end.

## August 13, 2026 — Banner GOAEMAL email-job diagnosis

- Confirmed the Data Connect job **Email Generation for Students** is configured to write an active, preferred `STD` `@g.sccc.edu` address for the `STUDENT` role, with display-on-web and preferred override enabled.
- Confirmed the stored `55/10 * * * *` schedule actually runs hourly at minute 55; it is not an every-ten-minute schedule.
- Validated `*/5 * * * *` as the correct every-five-minute schedule in the Data Connect UI.
- Data Connect rejected the job update before the schedule could be saved. The existing hourly job was preserved instead of disabling a working Banner write-back process.
- Documented that calculated `xEup.collegeEmail` data is not proof that Banner GOAEMAL has been written.

## August 13, 2026 — GOAEMAL five-minute replacement and key rotation

- Created a new Production API key for the Data Connect EUP package without changing the working legacy jobs first.
- Created **Email Generation for Students - Fresh Key Test 2026-08-13** as a run-now audit job. Two fresh-key test runs succeeded; the first processed one actual student record.
- Created **Email Generation for Students - 5 Minute** with the same `STD`, `@g.sccc.edu`, active, preferred, display-on-web, preferred-override, and `STUDENT` parameters as the former job.
- Scheduled the replacement for every five minutes in the `America/Chicago` tenant time zone. Data Connect generated the equivalent `*/5 */1 * * *` expression from its simple scheduler.
- Verified a manual run of the scheduled replacement succeeded from 6:06:10 PM through 6:06:26 PM CDT.
- Verified its first automatic scheduled run succeeded from 6:10:34 PM through 6:10:51 PM CDT.
- Configured failure and termination alerts to `maria.salas@sccc.edu`; successful runs do not generate routine email.
- Disabled the former **Email Generation for Students** job after the replacement had succeeded. The former job's misleading `55/10 * * * *` expression had actually run only once per hour at minute 55.
- Migrated the five-minute **External ID Generator** to the fresh key and verified its 6:10 PM scheduled run succeeded.
- Migrated **Email Generation for Staff and Faculty** to the fresh key and verified a manual run succeeded from 6:11:29 PM through 6:11:44 PM CDT.
- Replaced the key stored on the disabled former student-email job as a rollback safeguard while leaving that job disabled.
- Revoked the exposed legacy Production API key only after the active student-email, External ID, and staff/faculty paths had succeeded with the replacement key.
- Verified the student-email replacement continued to succeed on its 6:15 PM and 6:20 PM scheduled runs after legacy-key revocation.
- Verified the External ID generator also continued to succeed on its 6:15 PM and 6:20 PM scheduled runs after legacy-key revocation.

## Current enforced process

`Banner admission/eligibility → Banner GOAEMAL email job + Ethos EUP → AgentAD → AD → Entra validation → Google Workspace → EUP report → signed ACR registration-refresh request`

No Google account is created before Entra. A delayed or invalid student is isolated and retried without blocking later students. New accounts receive the Banner ID marker; existing untagged Google users are left intact and matched conservatively. ACR calculates enrollment independently from official Banner section registrations; account provisioning never increments enrollment totals.

## August 18, 2026 — EUP-triggered ACR enrollment refresh

- Added a signed machine-to-machine request from the EUP worker to ACR after actual provisioning completions.
- Kept enrollment calculation in ACR's existing `sync:banner:registration` job. EUP does not write headcount, registration, or credit-hour totals.
- Limited refreshes to current/next-term official Ellucian `section-registrations`; accepted students without section registrations remain excluded.
- Added a 15-minute debounce and a non-cancelling queue when another ACR synchronization is active.
- Made ACR refresh failure non-blocking for student account completion while recording the result in the EUP audit.
- Production verification refreshed 5,352 official registration rows for term `202630`, enriched 1,378 registered students, resolved seven identities, and cleanly skipped empty upcoming term `202710`.
- A repeat signed request was correctly reported as `debounced`.

## August 18, 2026 — GOAEMAL backlog recovery and permanent backstop

- Diagnosed the 22-student critical alert as a real Banner GOAEMAL backlog: the Data Connect example pipeline attempted a preferred `STD` insert, but Banner rejected students who already had a preferred personal address.
- Repaired the explicitly approved cohort through an Entra-gated, per-student process. All 21 students who already had verified Entra identities now read back as `provisioned`; Josue Constantino Escamilla Garcia (`800201765`) remained excluded because Entra verification was not satisfied.
- Preserved conflicting legacy `STD` records instead of deleting or overwriting them, then added and verified each canonical Banner/Ethos `xEup.collegeEmail` value as an active `STD` row.
- Installed and enabled `sccc-eup-banner-writeback.timer` on `app-server2`. It runs every two minutes, acts only on `waiting_for_banner_writeback` students already verified in synchronized `StudentPopulation`, validates the canonical Entra/Google address match, and performs an exact Banner read-back after every insert.
- Kept Ellucian Data Connect as the primary Banner writer. The new backstop is additive and idempotent, caps each run, tolerates a Data Connect race only after exact read-back, and isolates failures so one student cannot block the rest.
- The first automated Production run created and verified 15 newly eligible Banner `STD` rows. The next downstream EUP pass reduced the accepted-student queue to one genuine Entra/AD correction, not a normal five-minute processing delay.

## August 17, 2026 — Permanent orphan-account prevention and monitoring

- Added an independent two-minute accepted/current-term decision monitor so missing Ethos message-queue events no longer hide a qualifying student.
- Corrected identity resolution to use Banner/EUP's generated AD login, with the production `xEup.staffEmail` value used when `xEup.NewID` is not exposed.
- Added a guarded two-minute AD recovery task on `EntraCloudCon` with a ten-minute EUP grace period, HMAC-signed manifest, 800-number and identity validation, collision protection, employee/OU exclusion, and per-student failure isolation.
- Recovered 11 accepted students missed by the primary EUP path. All 11 reached AD, Entra, the A1 Student no-Exchange licensing group, and Google.
- Added a five-minute signed, read-only StudentPopulation snapshot covering 4,215 accounts.
- Corrected the snapshot to compare current student Google mail with Banner/Ethos instead of deriving it from the AD login. Nine false current-student warnings cleared without changing users.
- Added a two-minute signed Cloud Sync heartbeat containing service state, trace freshness, agent version, and active TLS relay count.
- Configured Windows service recovery for the Cloud Sync agent and restored its live relay connection.
- Added deduplicated incident and recovery email to `itech@sccc.edu` and `mark.bojeun@sccc.edu` for missed students, quarantines, stale worker/decision scans, current accepted-student AD problems, missing snapshots, and stopped/disconnected Cloud Sync.
- Added the permanent bulk-change safeguard: the recovery task creates a genuinely missing accepted student, but existing accounts are verification-only unless an administrator explicitly uses `-AllowExistingUserCorrection` after an approved review.
- Final verification showed 88 accepted/current-term students, 88 provisioned, zero current accepted-student AD issues, 17 active Cloud Sync relay sessions, and no active health incident.
- The remaining 129 exceptions in the 4,215-account historical StudentPopulation inventory were left unchanged and require a separate approved cleanup project.

## August 17, 2026 — Report duplicate and identity-source correction

- Corrected an HTTP 500 in the stand-alone EUP report caused by three historical duplicate Banner 800 numbers in the read-only AD snapshot. The report now groups duplicate keys safely and flags an affected displayed student rather than crashing.
- Removed the false assumption that every AD login must use `firstname.lastname`. Banner/EUP-generated shortened identifiers are valid AD logins.
- Stopped deriving the Google address from the AD login or Microsoft Graph `mail` field. The report now uses the accepted-student monitor and signed on-premises AD snapshot as the authoritative student-mail sources.

## August 17, 2026 — Canonical student AD login correction

- Identified seven current accepted students whose EUP identity profiles had a correct `xEup.collegeEmail` but a blank `xEup.NewID`; the recovery monitor had incorrectly fallen back to the staff-style `xEup.staffEmail`, producing first-initial AD logins.
- Made the Banner/Ethos student email local part authoritative for the AD UPN: `firstname.lastname@g.sccc.edu` becomes `firstname.lastname@sccc.edu`, including Banner-assigned numeric collision suffixes.
- Added a signed-manifest guard that rejects any future student recovery request whose AD UPN does not match the Banner/Ethos student email identity.
- Restored a visible report warning for existing AD-login mismatches. Existing identities remain verification-only until the exact accounts and collision checks are explicitly approved for correction.
- Final live verification returned HTTP 200 and showed 98 AD/Entra identities, 98 active Google accounts, 98 verified student AD mail mappings, and zero records needing review.
- At this checkpoint the change was reporting-only; the subsequently approved exact-account correction is recorded below.

## August 17, 2026 — Approved canonical AD-login correction

- Received explicit approval to correct exactly 10 StudentPopulation identities after a 6,398-user collision audit found no target UPN or `sAMAccountName` conflicts.
- Corrected Abner Macias-Gonzalez (800197133), Caleb Jones (800201791), Marc Campbell (800201586), Jaziel Fraire (800201790), Deacon Hockett (800201789), Jorge Frias (800201754), Parker Williams (800201767), Josue Escamilla Garcia (800201765), Maria Salazar Hernandez (800180378), and Sarahi Rivera Alvarez (800197090).
- Changed only each student's on-premises AD UPN and legacy `sAMAccountName`. Passwords, enabled state, object identity, OU, Banner ID, Google address, required groups, and Microsoft 365 student license were preserved.
- Confirmed all 10 corrections on AD-SC00, AD-SC01, AD-SC02, and AD-SC03.
- Confirmed Banner/Ethos already held the correct `collegeEmail`, so no Banner record was rewritten.
- Found that Microsoft Entra Cloud Sync is scheduled every 20 minutes (`PT20M`); the downstream worker's two-minute Entra poll does not shorten that upstream interval.
- Restarted only `AADConnectProvisioningAgent` after repeated relay WebSocket resets, then used Microsoft Graph `provisionOnDemand` for the exact 10 approved distinguished names. No full-scope restart or bulk synchronization reset was used.
- Verified all 10 canonical logins in Entra, confirmed the old UPNs no longer resolve, and confirmed every account remains enabled with its assigned student license.
- Corrected the AD snapshot and report validators to honor AD's 20-character `sAMAccountName` limit while retaining the full canonical UPN.
- Preserved the duplicate-Banner-ID report guard during deployment so a historical duplicate cannot cause the inventory endpoint to fail.
- Final live report verification at 5:07 PM Central showed all 10 as **AD and Google verified**, with **0 need review**.
- That result is retained as the August 17 checkpoint, not a permanent guarantee. The later August 20 exact correction resolved Josue's stricter recheck, and the expanded 250-account Banner checkpoint now supersedes it.
