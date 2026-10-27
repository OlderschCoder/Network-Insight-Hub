# Guarded additive collector retry v2 — prepared, not applied

This retry is prepared after the first apply restored the original configuration and verified rollback. The running image drops privileges to UID/GID 999:999; the first validation ran as UID 1000 and missed the production token permission mismatch. This v2 preparation changed only isolated synthetic scratch files/containers. No production configuration, real credential ACL, service or Influx write was changed while preparing v2.

Scope is the existing `sccc-ops` Telegraf on CiscoDirectoryConnector (`10.0.0.22`, ITADMIN UID 1000), actual runtime UID/GID 999:999, cached Telegraf image `sha256:e9fed213aa114dc196fe4cef487e815d7a3e65231cfa5421833b041029e899c6`. It adds one read-only token-file bind and appends the native-tested three HTTP inputs. Existing configuration bytes, global precision, SNMP, ping, Influx output, image, environment, other services and other containers must remain unchanged.

Pinned postimages:

- Compose: `E6D8C61891BCB8D737B860085C32738D443CB4D9D8431F8B738F459CD40A0945` → `4F868605E8F04FD383036683698894237A36EED31EBACDAD6679A16F802DCE67`.
- Telegraf config: `86F741119C6FD70FC7064880DCF7A110D5EBA4CAD456D046FD1559757C12B9E5` → `72E76ABB0E8A895526DA690397874A19AFD009A2319EB192101F8B897E6B5CD5`.
- Input-only addition: `A56042A70F455FF56AA0D403AFCE630C4CCC5300778D9FF6A23D08420588A501`.

After review, the directing thread may create a fresh ITADMIN-owned mode-0700 directory named `/home/ITADMIN/.cache/sccc-telegraf-apply-<unique-run>` and copy these package files there as mode 0600. Preserve exact file bytes. Do not reuse an existing run directory or change hash guards to bypass drift.

The directing thread separately streams the existing 43-byte export credential into `export.token.source` and its existing server SHA-256 hex digest into `export.token.sha256`, both ITADMIN-owned mode 0600 in that directory. This package contains neither value. Do not put the raw credential in Git, a command argument, shell history, logs or a broadly readable path. The applier validates the delivered file metadata, canonical credential shape and matching digest without printing either value.

```sh
# Future read-only inspection: no staging writes, native gather or service change.
python3 apply_telegraf_probe.py --stage-root /home/ITADMIN/.cache/sccc-telegraf-apply-UNIQUE
# Future activation only after directing-thread review; not executed during preparation.
python3 apply_telegraf_probe.py --stage-root /home/ITADMIN/.cache/sccc-telegraf-apply-UNIQUE --apply
```

Actual apply order:

1. Recheck file/hash/ownership, running-container IDs and health, cached image, and normalized Compose environment. Prepare private mode-0600 original backups/candidates under the mode-0700 run directory. Compare normalized Compose, allowing only the single token bind; parse combined Telegraf TOML, allowing only the three HTTP inputs. No old settings may differ.
2. Grant the same exact owner-set UID-999 read ACL to the staged input and staged export credential, then run an ephemeral, bounded, existing-image-only `--test --input-filter http` validation. It mounts only those files, runs as the actual UID/GID 999:999 with a read-only filesystem/capabilities dropped, and has no output plugin. No image pull/build, real SNMP gather, endpoint load test, alert or backend job mutation is invoked. Its real Fred calls are read-only export GETs.
3. Require read access to the existing Influx destination before production mutation. Its current output credential is used only in process memory for read-only Flux queries; it is not changed, printed or passed to a subprocess. Stop before mutation if it lacks read permission.
4. Reuse only the retained credential from the exact verified first rollback receipt (`1CAAE56950EDC01E090F81CB8C8003676D404B7D122A20B498D4E7BAE8BDA818`), exact owner-1000 mode-0700 directory and sole token child. Its content must match the independently delivered export-token digest. Grant only named UID 999 read access to that exact file, retaining owner 1000 read/write and no group/other access. The canonical POSIX ACL uses `os.setxattr`; no package, sudo or runtime-user change is needed. File mode 0640 reflects the read mask, while the owning-group ACL remains empty. Unknown ACLs/content/ownership are rejected. Atomically append/replace only the pinned Telegraf config and Compose file, preserving their existing ownership/mode. Recreate only `telegraf` with `up -d --no-deps --pull never --no-build telegraf`.
5. Within a shared 90-second acceptance budget, require unchanged Grafana/Influx containers, the same Telegraf image, no restart loop, healthy/running Telegraf, fresh assignment/building health points, and an exact original-time historical performance sample when one was present in the native export. Check its identity/outcome/bytes and reject fabricated Mbps on a failed sample. The known real feed currently has health and one failed sample, not a successful speed result.

Health/ingestion failure restores the exact old files and recreates only Telegraf, then checks the restored source hashes and healthy/running image. A timed-out Compose operation is treated as an unknown runtime outcome: sources are restored, no second overlapping Compose operation is started, and the receipt requires operator reconciliation. An unexpected third-party file/image/runtime change also stops rather than overwriting it. Private backups and the unreferenced private credential are retained for review after rollback; no Influx data is deleted.

Only metadata is written to the private `receipt.json`. `AppliedVerified` requires ingestion acceptance; a failed rollback or receipt write remains an error. This package does not create a dashboard, change either Fred pipeline, activate speed/capacity jobs, or approve receivers.

Local verification: Python syntax and sixteen pure synthetic tests passed. A real native-image permission fixture also passed: UID 999 read the synthetic config/token and emitted a loopback fixture metric; unrelated UID 65534 was independently denied both config and token access. Its [metadata evidence](native-reader-actual.json) confirms the production container IDs/PIDs/start/restarts and original source hashes remained unchanged. The atomic-replacement regressions distinguish failure before rename from directory open, fsync and close failures after rename; post-rename mutations remain recorded for rollback. No production applier execution, collector configuration mutation, real export-token use or Influx write occurred during v2 preparation. The directing thread must review this script and its file manifest before running it.
