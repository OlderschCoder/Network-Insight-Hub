# EUP accepted-student manifest

`GET /api/internal/eup-accepted-manifest` is the private, fail-closed bridge
between the Linux accepted-student/Banner verification snapshots and the
Windows EUP directory verification clients.

The route is mounted under `/api/internal`. It intentionally returns JSON 404
unless all of these network guards are true:

- the direct source address is `10.0.0.15` (`EntraCloudCon`);
- the HTTP `Host` is `10.0.0.44` with optional port `8080`; and
- `X-Forwarded-For` is absent.

A 404 from loopback, the public site, another VM, or a request with a forwarded
address is therefore an access-control result, not evidence that the route is
missing. See [the editable sequence diagram](eup-accepted-manifest-flow.mmd).

## Identity authority

The accepted-student monitor supplies cohort membership and observations. The
read-only Banner person verifier supplies login authority. A returned row must
have one fresh verifier result that proves all of the following:

- `BannerId` identifies exactly one verification row and one monitor row;
- `BannerUserName` is the exact lowercase, dotted Banner-issued value, is no
  more than 20 characters, and is unique in the verification snapshot;
- `UserNameVerified` and `IdentityLinkVerified` are literal `true`;
- `ExpectedUserNameSource` is `live_ethos_banner_username`;
- live `PersonId` equals `ExpectedPersonId` and the accepted monitor person;
- expected, live-profile, and accepted-monitor EID/UDC identifiers are
  well-formed GUIDs and agree; and
- the live verifier row is no more than 15 minutes old.

Names, `EntraUpn`, `CollegeEmail`, directory attributes, and `CanvasLogin` are
observations only. They never supply, expand, or truncate `BannerUserName`.
The route preserves those observations even when they disagree so downstream
verification can quarantine the record. The current accepted monitor does not
contain a Canvas read-back, so `CanvasLogin` is returned as `null`; it is never
filled with the Banner username to make a check appear to pass.

The accepted monitor's `GeneratedUtc` may be up to 60 minutes old, with at most
five minutes of future clock skew. This is deliberately separate from the
15-minute per-row Banner authority limit.

## Request authentication

The caller reads the shared key from its protected host file and sends:

- `X-SCCC-EUP-Timestamp`: current Unix seconds;
- `X-SCCC-EUP-Signature`: lowercase hex HMAC-SHA256 over the UTF-8 bytes of
  `<requestTimestamp>\naccepted-manifest`.

The API reads the same key from `EUP_MONITOR_KEY_PATH`, which defaults to
`/etc/sccc-eup/monitor.key`. The key must be at least 32 bytes and must never be
placed in source, an environment template, a report, or a log. The request
timestamp must be within 300 seconds of the API clock.

## Response authentication

HTTP alone does not authenticate the response body on this private route. The
API therefore serializes the manifest once with `JSON.stringify`, hashes those
exact UTF-8 bytes, and returns:

- `X-SCCC-Manifest-Timestamp`: API Unix seconds;
- `X-SCCC-Manifest-SHA256`: lowercase SHA-256 hex of the exact response bytes;
- `X-SCCC-Manifest-Signature`: lowercase HMAC-SHA256 hex using the same
  protected key.

The response HMAC canonical text is exactly:

```text
<requestTimestamp>\n<responseTimestamp>\naccepted-manifest-response\n<bodySha256>
```

The request timestamp binds the response to that request, while the response
timestamp supplies a separate freshness check. A client must, in this order:

1. read the raw response bytes without parsing JSON;
2. require the response timestamp to be within 300 seconds;
3. recompute and fixed-time compare the body SHA-256;
4. recompute and fixed-time compare the response HMAC;
5. only then parse JSON;
6. require `servedUtc` to represent the same Unix second as the signed response
   timestamp, `generatedUtc` to be no more than 3,600 seconds old (and no more
   than 300 seconds in the future), and each `BannerIdentityCheckedUtc` to be
   no more than 900 seconds old (and no more than 300 seconds in the future);
   and
7. require schema version and identity fields before using a row.

No successful response may be cached (`Cache-Control: no-store`).

## Schema version 2

The response envelope contains:

| Field               | Contract                                           |
| ------------------- | -------------------------------------------------- |
| `schemaVersion`     | Integer `2`                                        |
| `authorityContract` | `bannerUserName-exact-dotted-max20`                |
| `generatedUtc`      | Accepted-monitor generation time                   |
| `servedUtc`         | Same whole second as the signed response timestamp |
| `sourceCounts`      | Monitor, verifier, usable, and omitted row counts  |
| `students`          | Only rows with complete, unique, fresh authority   |

Every student row retains the accepted-monitor observations and explicitly
contains these authority/linkage fields:

| Field                      | Source                                                    |
| -------------------------- | --------------------------------------------------------- |
| `BannerUserName`           | Exact live verified Banner credential                     |
| `UserNameVerified`         | Literal `true`                                            |
| `IdentityLinkVerified`     | Literal `true`                                            |
| `PersonId`                 | Live verified Banner person UUID                          |
| `ExpectedPersonId`         | Accepted-monitor person UUID verified equal to `PersonId` |
| `UdcIdentifier`            | Accepted-monitor EID/UDC observation                      |
| `ExpectedUdcIdentifier`    | EID/UDC expected by the verifier                          |
| `ProfileUdcIdentifier`     | EID/UDC read from the live identity profile               |
| `BannerIdentityCheckedUtc` | Freshness time of the verifier row                        |
| `CanvasLogin`              | Actual monitor observation, or `null` when unavailable    |

## Failure behavior

- Missing, malformed, or stale source files produce 503.
- If the monitor has eligible accepted students but none has complete trusted
  authority, the route produces 503 rather than an ambiguous empty manifest.
- In a partially valid snapshot, unsafe rows are omitted and counted in
  `sourceCounts.omittedAcceptedRows`.
- A duplicate Banner ID, username, person UUID, or EID/UDC removes all affected
  rows from the usable set.
- Downstream writers must reject a missing or invalid response signature before
  JSON parsing and must independently enforce the schema, freshness, uniqueness,
  and observation checks.
