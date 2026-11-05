# Fred validated self-deployment — 2026-11-05

The CIO authorized deployment of the prepared building-health revision and future Fred publication of its own CIO-requested revisions. The original prepared revision `e9aaabc2f34e560dd649e989a981b12bb0f5c6415fc879a9593da44aea39d46b` was built from an older workspace without the live Astra adapter. It was reconciled with current production before rebuilding; the existing building-health changes and other prepared application changes were retained.

Deployed revision: `5313093c07702ffa50cdc9c3d82f0450e31f7328c23bd87f09d1bcfbae163b7e`.
Validation/release ID: `01079443-0aa8-4e39-b66c-db155d2dcb24`.
Independent validation passed 57 tests, sandbox isolation, frontend build and backend build, with unchanged source. The publisher recorded `DEPLOYED_HEALTHY`. The requested `/ai-report` URL and `/api/healthz` returned HTTP 200. Authenticated browser rendering was not inspected.

## Future publication

Only an authenticated CIO receives the `develop_website` tool, and the bridge rejects other roles. Fred may inspect and edit allowed application files, validate them in the existing isolated sandbox, prepare a release, and publish the exact current passed revision hash. Publication must be its final action in that chat turn. The chat returns an initiation notice before the service restarts; the independent controller records final success/failure, checks health, and rolls back failed releases. The Development tab remains available, including operator rollback. Model tools cannot request rollback or arbitrary commands.

Production credentials, auth/security, the deployment bridge/controller/publisher, baseline tests, and model/loop controls remain outside Fred's edit boundary. Before copying any release, the privileged publisher compares the staged hashes of `fred_responses.ts` and `openai.ts` against production. A stale workspace is rejected; the controller's original production-filesystem isolation is retained.

The code in `deploy/fred-development/` records the operator-owned `/opt/fred-development/` modules. These files require operator deployment and are not self-editable application paths.

## Loop and usage controls

Astra uses high reasoning throughout. Three consecutive identical completed tool rounds stop before another paid model call. JSON object-key order and call IDs do not change the comparison; changed arguments or evidence remain progress. `max_messages` stops immediately, interrupted arguments are discarded, and SDK retries are disabled. Each generation has an 8,192-output-token ceiling, including reasoning. Existing normal/development round allowances remain five/32 plus final synthesis. The CIO declined a daily spending cutoff. This is loop detection, not an account-wide dollar cap or detection of every possible unproductive pattern.

Structured request, usage, error and stop logs record random turn IDs, counts, timings and input/output/reasoning/cache token counts without conversation contents or credentials. Missing provider usage is unknown, not proof of zero billing.

## Recovery

The deployment publisher saved the previous application release beneath `/var/lib/fred-development/control/releases/01079443-0aa8-4e39-b66c-db155d2dcb24/before/`. Use the existing CIO Development rollback action to restore that application release.

The operator bootstrap and original prepared source are separately backed up in `/var/backups/fred-self-deploy-20261105/`, including the former controller, publisher, policy, protected-path list, acceptance runner, sandbox checks, bridge, adapter and source files. A full rollback of the new publication authority additionally restores these operator-owned files and restarts `fred-development` and `sccc-api`.
