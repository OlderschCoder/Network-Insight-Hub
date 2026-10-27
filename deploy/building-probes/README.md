# Existing NOC collector: verified Telegraf 1.30.3 addition

Status: **DeployedVerified at 2026-10-27T04:27:02Z**. The guarded v4 apply completed with `AppliedVerified` on CiscoDirectoryConnector (`10.0.0.22`). All five expected health assignments were observed in the existing Influx destination, and a historical failed performance point retained its original timestamp. No successful speed measurement is claimed. Probe jobs, speed tests and capacity gates were not activated by this collector integration; dashboards remain separately owned.

The input-only [configuration](telegraf-http.conf.example) reuses the existing `.22` Telegraf output. Telegraf 1.30.3 needs three independent HTTP inputs, each with one `json_v2` projection and input-specific `precision = "1ns"`. One input with three projections merged unrelated fields and measurements in the actual parser; default precision also rounded original sample times. Existing global precision, SNMP, ping and output settings must remain unchanged.

The frozen [guarded apply package](collector-native1303/README.md) is pinned to the inspected CiscoDirectoryConnector configuration and container. It adds one protected read-only token-file bind and appends the validated inputs, with source guards, private backups, bounded native validation, ingestion readback and rollback. It is not a generic installer: baseline drift must stop the operation. No credential is included. The directing thread supplies the export token through a separate protected stream.

Live acceptance used actual runtime UID/GID 999:999. Only Telegraf was recreated, healthy on the same image; Grafana and Influx runtime metadata remained unchanged. Existing SNMP, ping, agent settings and output were preserved. Applied Telegraf configuration SHA-256: `72E76ABB0E8A895526DA690397874A19AFD009A2319EB192101F8B897E6B5CD5`; Compose SHA-256: `4F868605E8F04FD383036683698894237A36EED31EBACDAD6679A16F802DCE67`. Frozen package documents retain their preparation status as historical evidence.

Run the synthetic checks locally with Python 3.11 or newer:

```sh
python3 collector-native1303/test_apply_candidate.py
python3 collector-native1303/validate_native_telegraf_1303.py --self-check
```

The native harness accepts only the exact reviewed binary hash and uses loopback synthetic data with `--test`; it has no Influx output. [Recorded native evidence](native-fixtures/native-1303-actual-20261027T030519Z.json) contains four successful gathers: mixed success/failure and nullable health, empty arrays, timestamp precision/offsets, and repeated historical samples. It demonstrates parser behavior, not successful live speed measurements.

## Change tally â€” 2026-10-26

- Preserve independent performance, capacity-window and health measurements and exact original timestamps on the existing Telegraf 1.30.3 binary; reviewed input SHA-256 `A56042A70F455FF56AA0D403AFCE630C4CCC5300778D9FF6A23D08420588A501`.
- Prepare the additive collector package; record a completed atomic rename before later durability operations so partial file changes remain eligible for rollback. Eleven pure synthetic tests pass.
- Retain all production services/configuration unchanged during initial preparation; deployment was accepted separately after the guarded corrections below.
- Prepare the UID-999 file-reader correction and exact reuse of the credential retained by the verified first rollback. Sixteen pure tests pass; the actual image permits UID 999 to read synthetic config/token and independently denies both to unrelated UID 65534. No production ACL or collector change was made during v2 preparation.

V3 refreshes only the baseline PID/start timestamp of the same Grafana container after another authorized chat restarted it. Other source/runtime pins remain unchanged; the v2 guard stopped before production mutation. No dashboard or provisioning file is included in this correction.

V4 corrects Docker top compatibility by including the mandatory PID column and matching that PID to the inspected Telegraf process. The corrected read-only command and eighteen pure tests pass; all baseline pins and proposed production files remain unchanged.

- 2026-10-27T04:27:02Z: v4 collector input deployed and ingestion verified: five of five health assignments and the original-time historical failed sample. No real credential or telemetry identifier is stored in this delivery record.
