# 2026-10-27 overnight endpoint baseline

## Activated measurement

The CIO-approved overnight baseline uses the existing authenticated Fred HTTPS
diagnostics path. Each computer receives one bounded job with 8 MiB download
and 8 MiB upload, latency, request-loss evidence, and server transfer receipts.
Jobs are serialized with forty-second start spacing and the API's thirty-second
post-report quiet period. This is an endpoint path sample, not a certification
of campus uplink capacity.

Two canaries completed before the fleet queue was created:

- `LP-AA152MB-01`: 48.1 Mbps down, 53.5 Mbps up, 41.8 ms latency.
- `LP-5G1Q394`: 81.0 Mbps down, 72.8 Mbps up, 67.9 ms latency.

After those canaries, 268 current online, enrolled, and AD-verified computers
were queued. The planned window is 2026-10-28 01:48:10Z through 04:46:10Z,
with a forty-five-minute expiry allowance for a missed check-in. The maximum
planned transfer is about 4.2 GiB across the fleet. Every job has a matching
database audit entry naming the approval and bounded method.

Only 22 scheduled computers had a current network-confirmed building. Other
jobs intentionally retain no building tag rather than inventing location from
stale or manually assigned evidence.

## Dashboard change

Private reporting release 1.3.2 adds four summary panels to the existing
`sccc-device-performance` dashboard: current online computers, distinct
computers measured, successful endpoint samples, and failed endpoint samples.
The existing per-building/computer download, upload, latency, loss, endpoint,
and access-port panels are preserved. The dashboard text distinguishes this
bounded Fred path from the separately versioned MultiStreamV2 method.

The guarded verifier also ignores repeated Influx annotated-CSV header rows
when calculating the newest performance timestamp. The first promotion attempt
exposed that parser defect and rolled back automatically before this narrow
correction was applied.

## Deliberate boundary

No enrolled computer currently advertises the signed `librespeed-v2`
capability. The staged MultiStreamV2 source therefore remains disabled and was
not substituted into this baseline. A true active Ethernet/Wi-Fi comparison
requires reconciling the reviewed module into SCCC-Key, building and signing
the release with SCCC's approved code-signing identity, and completing a
separately approved pilot before broader activation.

## Methodology correction

The 8 MiB single HTTPS transfer was stopped after field comparison showed that
its results were not comparable with Speedtest or nPerf. TCP/TLS startup and a
short single stream dominated the sample, producing rates far below the
700+ Mbps observed in direct building tests. At correction time, 140 jobs had
completed, five had expired, and 123 remaining queued/running jobs were
cancelled with audit records. Completed data was preserved rather than erased.

Private reporting 1.3.3 excludes the superseded `type=fred` samples from every
panel labeled as endpoint or building speed. Those panels now accept only the
reviewed `type=librespeed-v2`, `method=MultiStreamV2` contract. Timing-only Fred
evidence remains available where it is explicitly labeled as external path
timing. Until the signed MultiStreamV2 endpoint capability is deployed, speed
panels intentionally show no validated data.
