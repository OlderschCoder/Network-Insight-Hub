# Fred application development

The live CIO assistant exposes `develop_website`: list/read application sources, write or replace exact text with a SHA-256 concurrency check, inspect changes, run independent validation, and prepare a release. CIO coding requests get up to 32 tool rounds, recognized from the current request before operational evidence gathering, with enough output budget for source edits. The first coding tool call is required after evidence gathering for explicit coding requests. Validation waits up to two minutes within a tool turn and can be checked later through status.

The workspace is `/var/lib/fred-development/workspace` on app-server2. Production remains `/home/scccadmin/apps/Network-Insight-Hub`. The original Windows checkout was preserved; implementation is in the isolated `codex/fred-page-assistant` branch. Production contained additional changes absent from GitHub; those were retained in the deployed integration.

## Authority

- CIO role required for the coding tool and `/api/fred-development` routes.
- Fred can edit frontend/backend application and its own prompt/tool orchestration source, plus library source and documentation.
- Credentials, authentication/security modules, acceptance tests, dependency/build configuration and the development bridge/controller are protected.
- The model action allowlist excludes publish and rollback. A separate CIO Development tab reviews and deploys an exact validated source hash.
- No arbitrary shell tool, dependency installation, production database access or schema migration is provided by this workflow. Existing application data tools retain their permissions.

The root-owned controller under `/opt/fred-development` runs validation as the unprivileged `fred-code` user with no network, private temporary directories, a hidden home directory, read-only dependencies/tests/configuration, resource limits, and no production environment. Its control socket, audit and release storage are not reachable by sandbox code.

These controls isolate execution before deployment. Approved application code runs with the existing production API account's privileges, so code review still matters. Passing a build does not prove a change improves usability or correctness across the entire product.

## Validation and release

Protected validation runs sandbox-boundary checks, 42 tests for site-route coverage, page context, coding authorization/request routing, building service-evidence regressions and wallboard performance evidence, followed by frontend and backend production builds. The controller verifies the source is unchanged after the run. Source modifications invalidate the last validation. Two separate policy tests cover allowed application edits and rejected escapes/protected paths.

Publishing copies artifacts into a protected versioned release, saves previous artifacts and changed source, restarts `sccc-api`, and checks `/api/healthz`. Failed startup triggers artifact/source restoration. A release identifier cannot overwrite an existing release directory. The CIO can request rollback of the last successful Fred release. Database changes are excluded.

The initial integration was deployed separately with a backup under `/home/ITADMIN/releases/fred-20261030-usability/before-development`; pre-usability artifacts are stored alongside it. Setup/finalize/deploy scripts are one-time operator tools, not agent tools. Never rerun baseline initialization over Fred's active edits.

## Usage

Open `/ai-report`, select Ask Fred, and describe an application change. Fred should inspect actual source, edit it, inspect its diff, validate, fix failures, and prepare a release. Open the Development tab to review the diff and validation log, then deploy the reviewed revision. The panel on other pages provides page-aware guidance and uses existing supported information/update tools.

The acceptance suite is an initial baseline, not exhaustive regression or performance coverage. Broader automatic production release authority is not enabled. Repository-wide TypeScript checks still have pre-existing errors outside this change.

## Verified rollout, October 30, 2026 Central time

- Live CIO chat called `develop_website`, read and edited `FredAssistant.tsx`, ran validation, and prepared release `955ed25e-61cc-4b71-a35b-ce3538723b00`.
- The source revision was `78912b61658b020338cc7f0678a55175c246134d298c8f3fcc711e0b7b91557b`; the edit made the panel subtitle explain page questions, information lookup and recording updates.
- An initial publisher filesystem-permission failure was corrected in the trusted controller. Validation stays capability-free; only the fixed publisher receives DAC override/file-owner capabilities within its restricted writable production/release directories.
- Deployment through the CIO UI succeeded as release `19fd2fb2-42b1-4dae-885b-6abfbad73636`. A manual rollback restored source/artifacts and passed health. The validated change was then redeployed as `2cb28243-c5a9-4e1c-95ce-94dcb42d5966`, again healthy.
- The browser automation stalled on its native JavaScript confirmation; rollback was exercised through the same controller from a fixed operator test service. The final browser screen independently showed `Validation: passed` and `Last release: deployed`.
- Unauthenticated access to the development endpoint returned HTTP 401. Protected tests reject non-CIO calls and model attempts to publish/rollback.

The change diff is currently relative to the initial workspace baseline, so it can include already-deployed edits. Release IDs are immutable; publishing the same validation ID again is rejected. Request a fresh validation for a new release. Setup and recovery-check services are not enabled or scheduled.

## Wallboard evidence, October 31, 2026

Fred now exposes `query_wallboard_performance`, a read-only query of the existing InfluxDB source behind the SCCC IT Operations Wallboard. The dashboard is on port 3000, with UID `sccc-it-tv-wallboard`. Building speed results use the dashboard policy: latest LibreSpeed MultiStreamV2 value per building/computer/adapter, averaged across those samples over 24 hours by default. Results preserve actual sample ages and disclose the difference from the Buildings page aggregation policy. WAN results are inbound plus outbound interface traffic by ISP, not circuit capacity. Independent panel failures return partial results and named errors; missing data is not replaced with zero.

Release `680e21fe-224a-4034-8732-916690605673` passed 42 protected tests, sandbox checks and both production builds, then deployed healthy through the CIO Development page. Live Fred chat verified West Campus 924.86 Mbps download / 710.26 Mbps upload from the Oct. 30 21:06 CDT sample, plus current IdeaTek and United traffic with observation timestamps.
