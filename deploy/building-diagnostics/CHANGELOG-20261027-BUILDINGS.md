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
and direct group GUID/name/DN. Old publishers remain compatible. Missing facts
are retained only for the same trusted AD snapshot and unchanged computer identity;
a new snapshot cannot inherit old facts. Network location and historical results
remain separate from the assigned building. No AD membership is modified.

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

Delivery checkpoint: integrated candidate prepared; live application and publisher
read-back must be recorded below after deployment.
