# Editable computer buildings — 2026-10-27

The diagnostics portal uses Fred's live campus building catalog. Administrators
can check AD computers and assign or clear a building in one explicit action.
Enrollment, measurements and building assignments use independent checkbox sets
and visible Select all controls. Device lists and counts use unique AD GUIDs.

An administrator can also map a verified AD computer group's object GUID to a
canonical building. Current and future members inherit that building. A manual
computer assignment takes priority; clearing it restores the group default.
Conflicting group mappings remain unresolved. Mappings can be edited or cleared,
including a saved mapping whose group no longer has current members.

The optional directory feed records actual computer DN, canonical path, Location
and direct group GUID/name/DN. Old publishers remain compatible. Omitted facts
are retained for unchanged GUID/name/domain/enabled identities while their original
observation remains within 24 hours; newer rosters and collector roundtrips never
renew that timestamp. Network location and historical results remain separate
from the assigned building. No AD membership is modified.

Writes require the existing network administrator role, an Entra-linked actor,
fresh AD facts, a reason and an explicit Apply request. Changes are transactional
and audited with old/new values. This release does not queue enrollment or load.
LibreSpeed preparation belongs to the coordinating NOC chat and is separate.

Verification: 39 diagnostics HTTP/library tests, 23 assignment HTTP/library tests,
22 diagnostics PostgreSQL cases, 6 assignment PostgreSQL cases, and 14 focused
browser cases passed. PostgreSQL tests used disposable private clusters. Native
exporter/update checks passed on PowerShell 5.1 and 7. The integrated Linux API
and frontend build passed using 372 pinned live inputs, with only five source
overlays. Unrelated live changes were preserved.

The guarded `release-building-assignments.py` publisher preserves original files,
ownership and modes, and verifies source/artifact/policy hashes before mutation.
It requires a quiet API measurement window and refuses unsafe rollback/restart
if runtime policy or activity has changed. Publisher credentials, scheduler gates,
endpoint credentials, alerts and MFA keys are outside this change.

The AD publisher update is separately signed and paired with its existing wrapper
because the installed task pins both scripts to the same signing certificate.
The updater keeps the existing protected worker ciphertext, ACLs and task
definition. It uses an idle task fence and exact pre-enable rollback checks.

## Applied delivery and OU clarification

The user's AD screenshots identify folders/organizational units under
SC-Computers, rather than security-group membership. The deployed follow-up adds
actual OU GUID/name/DN ancestry and an editable folder selector. Computer
overrides take priority, then the nearest explicitly mapped OU, then its mapped
parents. A folder mapping includes nested computers. Directory ancestry is
validated against unescaped DN boundaries and sorted independently of feed order.
Security memberships remain separate facts; their names do not infer buildings.

The OU follow-up passed 50 focused unit/HTTP tests, 7 real PostgreSQL cases and
6 browser cases. The earlier bulk-checkbox regression suite also passed. The
production API/UI were rebuilt from 374 pinned live inputs and applied with
verified hashes, health and authentication boundaries. API PID after release:
538433. Both source overlays and rollback artifacts are retained in the private
fred-building-assignment-release-20261027T1018Z-ou release directory.

A complete normal-token AD read was imported through the existing private-worker
API on 2026-10-27 at 10:24:21Z. Its 675 unique computer identities exactly matched
the existing roster; all received real OU facts. The source query found 188 OUs;
142 have computers represented in this snapshot. The worker credential stayed in
server memory. No AD object, membership, permission or schema was changed.

The paired OU-aware Windows publisher package v2 is signed and prepared, with
the existing task/credential/ACL preservation checks. It is not applied: the
publisher laptop's normal management connection is unavailable. Package v1 is
obsolete. The old optional-omission publisher remains installed and has not been
upgraded. This one-time import does not establish continuous OU refresh: the
compatibility correction below retains facts only until their original 24-hour
expiry. Saved building crosswalks and overrides persist.

The authenticated UI saved five confirmed computer corrections (Humanities,
Student Living T, Mansions, Student Living Center and Student Union), then saved
and individually read back nine confirmed OU mappings covering 88 unique enabled
computers. The live editor showed 142 unique populated AD folders. The confirmed
crosswalk and original AD facts are retained privately; unknown folders were not
assigned by hostname. A prior LP-F6K6S64 override remains disputed following the
user's correction to a different, non-AD office laptop. Clearing that one override
is waiting for the UI's required action-time confirmation.

## Legacy publisher retention correction — applied

After a newer legacy roster cleared optional OU facts, the API gained a separate
`directory.observedAt`. Both ingestion paths retain unchanged identities' fresh
facts without refreshing their age; snapshots and OU defaults use that original
time and still require a fresh base AD roster. Fifty-six focused unit/HTTP checks
and 22 disposable PostgreSQL cases passed, with independent source review.

The guarded retention release was applied and verified with API PID 553995;
artifacts remain in `fred-building-assignment-release-20261027T1103Z-retention`.
Fresh facts for 675 computers were captured at 11:03:53Z and imported through the
existing authenticated worker API, with read-back at 11:06:40Z. The old publisher
is still not upgraded; original fact timestamps expire after 24 hours rather than
being renewed by its later roster posts. No authorization, mapping or job change
was part of this compatibility release.

## Approved diagnostics rollout and presence correction

The two existing approved queues processed 243 distinct AD identities: 117
installed, 122 unreachable (89 private-DNS and 33 Kerberos), three failed, and
one already enrolled. The first client stopped with exit 1; server/proxy evidence
did not establish its precise external request failure. Only the 15 conclusively
never-claimed targets were continued, and that client exited 0 with both queues
empty. No uncertain or unrelated queue was replayed.

Four installed Surface helpers could not generate presence because an enumerated
adapter had no IP-interface record. The verified production source matched the
local module body. Version 1.1.1 skips only the two exact missing-interface-index
errors and rethrows other failures; 58 focused checks passed under PowerShell 5.1
and 7. The module and four-host updater were independently reviewed and signed.
The canary then the other three received only that module and one diagnostics-task
restart. Configuration metadata, task definitions, credentials and MFA were
preserved. All four subsequently authenticated as 1.1.1 using their original
enrolled identities. All 117 new installations now have authenticated check-ins.

The existing protected bulk payload remains frozen at 1.1.0; the focused updater
does not silently replace that deployment package. Receiver 0.4.5 evidence remains
297 installation receipts and 269 dated runtime checks. The finite LibreSpeed
baseline and its verified Grafana dashboard are separate from recurring testing.
