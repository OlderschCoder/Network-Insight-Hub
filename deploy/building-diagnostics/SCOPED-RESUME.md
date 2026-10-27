# Scoped diagnostics queue resume

The optional `requestIds` filter restricts the existing private-worker claim transaction before FIFO selection and row locking. Omitting it preserves the legacy behavior. UUID input is bounded and deduplicated; the global four-claim limit, worker authentication, expiry quarantine and one-time credential rules remain unchanged.

`Resume-ScopedDiagnosticsEnrollment.ps1` resumes only the two existing reviewed requests. It requires the existing protected worker credential, reviewed controller baseline and signed payloads. It creates no local worker authority or payload stage. Remote installation retains the original signed installation path and `permitSustained=false`.

The resume is finite: at most 255 newly claimed targets, 256 pages and six hours. It validates returned scope and identities before provisioning, continues past skipped pages, and holds on foreign work, replay, blocked claims or uncertain one-time/result delivery. Interrupted claims are quarantined by the existing backend; they are not replayed. Running without `-Execute` validates without claiming work. Normal Windows elevation is required; no execution-policy override is used.

Validation: nine unit/HTTP route tests, ten real PostgreSQL integration tests in a private disposable cluster, and nineteen AST-extracted PowerShell guard cases passed. The integration cases preserve 222 foreign queued targets, legacy FIFO, the global concurrency cap and existing credential hashes.

The finite script is timestamp-signed by Seward County Community College. Its reviewed unsigned body is `F495BA0DFA23CE9502B3958BE00319FD727C1D435417AE47896B3522DC08C84F`; the signed artifact is `70D48A8D66444E86E7C2BE8C5D155DFBA87120E74487A24A629DB73788606C25`.

`release-scoped-claim.py` builds an isolated copy of the latest live API source, overlays only the two enrollment files and pins source inputs, artifacts, ownership, service PID, unit/environment-file fingerprints and frontend index. Explicit apply requires the frozen manifest hash and normal sudo, makes backups, verifies health/auth boundaries and retains guarded rollback. Preparation does not deploy. No frontend, scheduler, measurement, key or GPO change is included.

The two-file API update was applied at **2026-10-27 07:33:59 UTC**, with service PID 432055 changing to 479441. Independent readback at 07:37 UTC matched both frozen source hashes, healthy API/Entra status, the existing authentication boundary and the unchanged frontend index. The selected 248+7 queued targets and separate 222-target request remained unchanged; deployment claimed no work and changed no credentials.

The signed finite Windows resume client is prepared and independently reviewed but **not launched** as of that readback. Its normal administrator approval is a separate step. Private release/queue receipts remain outside Git.
