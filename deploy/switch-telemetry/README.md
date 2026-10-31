# Resilient nightly switch telemetry

Restored on 10.0.0.22 on October 31, 2026 after the configured collector installation was found missing. Collector/parser and audit utilities were recovered from the local release-81f018b backup. Dependencies came from its existing virtual environment; no package installation or credential rotation was needed.

The runner holds the existing collection lock and processes each device independently. Missing, failed, duplicate, unexpected, stale, future, or invalid results are reported rather than published. Each eligible device must pass an authenticated portal dry run before its write. Failed preflight or write requests do not stop later devices. Authentication and schema checks remain required.

At least one publication yields completed_with_warnings if exceptions remain; zero publications marks the run failed. Status includes device, IP, building, stage, reason and observation time. latest-attempt tracks every run, while latest tracks the most recent run with published data. Raw CLI stays restricted on the collector.

The restored control API retains fixed status/audit/run endpoints, bearer authentication, source restrictions, and the single permitted systemd start command. Fred reads these through switch_telemetry_from_noc. Audit does not substitute an old successful run for the latest failed attempt.

The recovered release lacks the newer firewall freshness checker. Both configured firewalls are explicitly reported as coverage exceptions, without inferring outages. Other NOC, Telegraf, wireless and endpoint collectors remain in place.

## Installation and verification

- Active release: /opt/sccc-switch-telemetry/releases/20261031-resilient.
- Existing service restrictions, environment files, credentials, sudoers and timer are retained.
- Schedule: 03:15 America/Chicago plus up to 15 minutes fixed random delay.
- Use the reviewed 48-target manifest from the October 30 run. The older backup's excluded USD480 target must not be reintroduced. Catalogs and credentials remain on the collector.
- Pre-repair service definitions and status are retained under /var/backups/sccc-switch-telemetry/repair-20261031. Original evidence and the old release backup remain available.
- Eight unit tests cover continuation after collection/preflight/write failures, missing and duplicate targets, stale/future results, missing interfaces and invalid aggregates. They passed locally and in the recovered Linux environment. Python compilation and shell syntax checks also passed.

Run tests with `python -m unittest discover -s deploy/switch-telemetry -p test_resilient_runner.py -v`.

## Live result

Run `20261031T053540Z-2942840` finished October 31 at 00:41:50 CDT (05:41:50 UTC), with systemd exit status 0 and state completed_with_warnings. It collected and published 44 of 48 switch targets; all 44 write responses were HTTP 200. Four collection exceptions remained: sw-aa144, swa-aa148 and swa-m201 had unreachable SSH ports; sw-cafe rejected authentication. Two additional entries explicitly describe unavailable firewall freshness checks. The nightly timer remains enabled, next observed trigger 03:26:58 CDT.

Fred read the in-progress status through its existing tool and saved the requested partial-success reporting policy to team memory. Unauthenticated status and audit requests returned HTTP 401.
