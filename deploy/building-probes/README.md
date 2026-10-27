# Existing NOC collector: prepared Telegraf 1.30.3 addition

Status: **Prepared, not applied**. This source delivery does not activate probe jobs, speed tests or capacity gates. Deployment and real Influx ingestion require separate live acceptance evidence.

The input-only [configuration](telegraf-http.conf.example) reuses the existing `.22` Telegraf output. Telegraf 1.30.3 needs three independent HTTP inputs, each with one `json_v2` projection and input-specific `precision = "1ns"`. One input with three projections merged unrelated fields and measurements in the actual parser; default precision also rounded original sample times. Existing global precision, SNMP, ping and output settings must remain unchanged.

The frozen [guarded apply package](collector-native1303/README.md) is pinned to the inspected CiscoDirectoryConnector configuration and container. It adds one protected read-only token-file bind and appends the validated inputs, with source guards, private backups, bounded native validation, ingestion readback and rollback. It is not a generic installer: baseline drift must stop the operation. No credential is included. The directing thread supplies the export token through a separate protected stream.

Run the synthetic checks locally with Python 3.11 or newer:

```sh
python3 collector-native1303/test_apply_candidate.py
python3 collector-native1303/validate_native_telegraf_1303.py --self-check
```

The native harness accepts only the exact reviewed binary hash and uses loopback synthetic data with `--test`; it has no Influx output. [Recorded native evidence](native-fixtures/native-1303-actual-20261027T030519Z.json) contains four successful gathers: mixed success/failure and nullable health, empty arrays, timestamp precision/offsets, and repeated historical samples. It demonstrates parser behavior, not successful live speed measurements.

## Change tally — 2026-10-26

- Preserve independent performance, capacity-window and health measurements and exact original timestamps on the existing Telegraf 1.30.3 binary; reviewed input SHA-256 `A56042A70F455FF56AA0D403AFCE630C4CCC5300778D9FF6A23D08420588A501`.
- Prepare the additive collector package; record a completed atomic rename before later durability operations so partial file changes remain eligible for rollback. Eleven pure synthetic tests pass.
- Retain all production services/configuration unchanged during preparation. Live deployment, ingestion and dashboard acceptance are not asserted by this source commit.
