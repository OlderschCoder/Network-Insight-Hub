# Fred building and switch outage alerts

Fred can send operational SMS and email notifications when a deliberately
selected building anchor or one of its child switches changes state. This is
an infrastructure alerting path for the SCCC IT team. It is separate from any
SafeDate messaging profile, number, recipients, webhooks, or data.

The alert worker is disabled by default. Do not enable it until every building
anchor has been reviewed against the physical topology and a labeled test
message has been accepted by the configured delivery channels.

See [fred-building-alerts-flow.mmd](fred-building-alerts-flow.mmd) for the
editable data-flow diagram.

## Alert contract

- Each monitored building has one explicit anchor switch. Fred never guesses
  an anchor from alphabetical order, inventory order, current status, or the
  number of switches in a building.
- The worker evaluates enabled anchors every 30 seconds by default. A
  durable PostgreSQL lease is claimed before any monitoring probe. It enforces
  one global poll cadence across API replicas and fences an expired worker
  before state can be committed. An advisory transaction lock remains as a
  second guard.
- Before probing, Fred validates the full enabled topology. Building keys and
  normalized names must be unique, and no anchor or child switch ID may appear
  in more than one enabled building. Any ambiguity fails the entire cycle.
- A fresh NOC `up` or `down` observation is authoritative. A NOC execution
  error or explicit `unknown` is not evidence and falls through to a fresh
  Influx observation. Fred runtime-validates every NOC batch; malformed,
  duplicate, or unrequested entries invalidate that batch and also fall through
  to Influx rather than becoming outage evidence. True conflicts between
  independently normalized fresh observations remain `unknown`. The default
  freshness window is 90 seconds.
- Missing, stale, future-dated, conflicting, or explicitly unknown evidence is
  `unknown`, never `down`. Unknown evidence resets a partial down or recovery
  count and cannot open or close an incident.
- Three distinct consecutive fresh `down` observations open an incident. Two
  distinct consecutive fresh `up` observations close it and send a recovery.
  Re-reading the same telemetry timestamp does not advance a counter. The
  pre-probe lease enforces cadence even when probes take different amounts of
  time to finish. A long gap starts a new failure or recovery sequence rather
  than completing an old one.
- When a building anchor is in outage, child-switch alert transitions for that
  building are suppressed. This avoids turning one upstream failure into a
  small novel delivered by SMS.
- Maintenance and mute windows gate delivery only. Fred still persists the real
  telemetry, counters, and incident transition, plus an auditable policy record
  explaining why notification was suppressed. Acknowledgement, assignment,
  mute, maintenance, resolution, and reopen actions remain attributable in the
  database.

The thresholds are also stored with each anchor so an intentional, reviewed
exception can be represented without changing all buildings. The production
baseline remains three failures and two recoveries.

## Durable state and delivery safety

PostgreSQL stores the anchor selection, consecutive-observation state,
incidents, suppressions, operator actions, and channel delivery attempts. A
stable transition idempotency key and a unique database constraint prevent the
same outage or recovery transition from being submitted twice after a process
restart. Telnyx's send-message operation does not supply a provider-side
idempotency guarantee for this workflow, so the database claim must be written
before sending. Incident identities retain a short readable slug but also
include a truncated SHA-256 digest of the length-delimited scope, building,
target, and first-down timestamp, so different raw identifiers cannot collide
after slug normalization.

The poll lease remains durable across a crash for longer than one normal poll
interval. A normally completed cycle shortens the lease to no earlier than its
next eligible poll time. State persistence locks and verifies the lease token,
so a stalled replica cannot wake up after lease takeover and count stale work.

Delivery records store a one-way recipient hash and, when needed for operator
correlation, the last four digits. They must not store or log a full phone
number, API key, webhook public key, or raw webhook body. Provider errors saved
for troubleshooting must be redacted. Recipient hashes use HMAC-SHA-256 with
`FRED_ALERT_RECIPIENT_HASH_KEY`; a plain phone-number hash is too easy to
enumerate and is not acceptable for production.

## Telnyx roles and configuration

Use a Fred-specific Telnyx API key and messaging profile:

| Setting                            | Purpose                                                                                           |
| ---------------------------------- | ------------------------------------------------------------------------------------------------- |
| `FRED_TELNYX_API_KEY`              | Secret API key limited to Fred's Telnyx work.                                                     |
| `FRED_TELNYX_MESSAGING_PROFILE_ID` | Messaging profile assigned to the Fred sender.                                                    |
| `FRED_TELNYX_FROM_NUMBER`          | Fred's SMS-capable sender in E.164 form, such as `+1<SENDER>`.                                    |
| `FRED_ALERT_TO_NUMBERS`            | Comma-separated approved personal and work alert recipients, such as `+1<PERSONAL>,+1<WORK>`.     |
| `FRED_PUBLIC_BASE_URL`             | Public HTTPS origin for the deployed Fred API, with no path suffix.                               |
| `FRED_TELNYX_PUBLIC_KEY`           | Telnyx Ed25519 public key used to verify callbacks; this is not the API key.                      |
| `FRED_ALERT_RECIPIENT_HASH_KEY`    | Dedicated random secret (32+ characters) used to HMAC recipient identifiers before audit storage. |
| `FRED_ALERT_EMAIL_TO`              | Independent operational mailbox used when SMS delivery cannot be accepted.                        |

The two recipient roles are deliberate: the personal and work destinations
receive Fred infrastructure alerts only. They are not SafeDate user numbers,
and the work destination must never receive private SafeDate content.

Fred supplies callback URLs on each outbound message and disables profile
webhook inheritance for that message:

- Primary: `https://<fred-host>/api/telnyx/fred/status`
- Failover: `https://<fred-host>/api/telnyx/fred/status/failover`

The endpoints verify the Telnyx Ed25519 signature against the exact raw body,
enforce a five-minute timestamp window, and claim each provider event ID once
before updating the delivery audit. Invalid, expired, or duplicate callbacks
must not mutate delivery state.

Both URLs currently terminate on the same Fred VM. The failover URL satisfies
Telnyx's separate-URL requirement and can recover from a route-specific error,
but it is **not infrastructure-independent**: a VM, reverse-proxy, DNS, or
regional outage can make both unavailable. A later production hardening step
should place the failover receiver in another fault domain and forward verified
events into the same durable store.

The Telnyx number must be SMS-capable, assigned to this messaging profile, and
authorized for the registered messaging use case before production traffic is
enabled. Operational messages must identify Fred/SCCC IT, match the registered
use case, and honor carrier and Telnyx opt-out rules. Do not send after a
recipient replies `STOP`; use Telnyx's supported opt-in path before resuming.

## Runtime settings

Keep these non-secret controls with the service configuration and secrets in a
root-owned environment file rather than in Git:

```dotenv
FRED_ALERT_ENABLED=false
FRED_ALERT_POLL_INTERVAL_SECONDS=30
FRED_ALERT_MAX_OBSERVATION_AGE_SECONDS=90
```

`FRED_ALERT_ENABLED=false` is the safe deployment value. Changing it requires
a service restart because configuration is read at process start. Do not lower
the poll interval merely to make a test finish faster; use the dedicated test
command instead.

`FRED_ALERT_ENABLED` accepts only `true` or `false` (case-insensitive). An
enabled worker's runtime, webhook-verification, and Telnyx settings are
validated before the API opens its listener. Invalid configuration therefore
fails startup instead of quietly running a healthy-looking API without Fred.

## Health and readiness

`GET /api/healthz` includes a sanitized `fredAlerts` object with the worker
state (`disabled`, `starting`, `ok`, or `degraded`), the last successful-health
and failed-cycle timestamps, and a generic error code. A successful health
observation can be either a locally completed cycle or confirmation that
another replica holds the active shared lease. It never includes phone numbers,
API keys, configuration values, provider payloads, or exception text.

Disabled alerting is an intentional healthy state. Once alerting is enabled,
the endpoint returns HTTP 503 while the worker is starting or degraded. It
returns HTTP 200 after this replica completes a successful cycle or observes an
unexpired shared lease held by another replica. Missing enabled anchors, true
lease-fence or lease-completion failures, invalid SMS configuration, tick
failures, and fallback failures degrade readiness so external monitoring cannot
mistake a broken alert path for a healthy one.

## First activation

1. Deploy the code and database migration while
   `FRED_ALERT_ENABLED=false`.
2. Insert each candidate anchor with `enabled=false`. The migration also uses
   `false` as the database default; keep the value explicit in operational
   scripts. Join by the exact `network_switches.id`; do not infer an anchor
   from building membership.
3. For every building, compare the candidate to current diagrams,
   configuration evidence, and an operator's physical-topology knowledge.
   Confirm that loss of this switch actually represents loss of the building,
   then enable that anchor row.
4. Confirm that the NOC and Influx observations include timestamps and that
   stale or missing data resolves to `unknown`.
5. Confirm Telnyx sender/profile assignment, messaging authorization, both
   HTTPS callback routes, and the configured email fallback.
6. Run the safe test below. Verify acceptance and the later final delivery
   status for both approved recipient roles; also inspect the redacted database
   audit.
7. Restart the service with `FRED_ALERT_ENABLED=true`, then poll
   `GET /api/healthz`. Require HTTP 200 with `fredAlerts.state=ok`; if it remains
   HTTP 503, use the sanitized `fredAlerts.errorCode` to correct the startup or
   worker failure before enabling real alert traffic.
8. Watch one full three-observation failure window plus one two-observation
   recovery window without manipulating production network equipment.

An anchor can be disabled independently at any time. Global enablement never
overrides a disabled anchor, maintenance window, or mute.

## Safe delivery test

From the deployed application directory, load the same root-protected
environment files used by `sccc-api` and run the bundled command as the service
identity:

```bash
node artifacts/api-server/dist/scripts/send_fred_test_alert.mjs
```

The command sends only this labeled non-incident text to the configured Fred
recipients:

> [FRED TEST] Alert delivery is working. No building outage is active. Reply STOP to opt out.

It must not create an outage incident, change counters, or simulate a network
failure. Treat the Telnyx API's accepted response as submission, not proof of
delivery; verify the signed `message.finalized` callback and audit status. If
the send is rejected, keep production alerts disabled and use the redacted
provider code to check sender/profile assignment, messaging authorization,
destination consent, or account balance.

## Email fallback

Email is a separate channel, not a Telnyx failover webhook. Fred makes one
bounded Telnyx submission attempt for each recipient and transition. If Telnyx
rejects it, or if a timeout or restart leaves acceptance ambiguous, Fred does
not automatically resubmit the SMS because the provider offers no idempotency
guarantee for this workflow. Fred records the failed or unknown SMS attempt and
sends the same operational summary to
`FRED_ALERT_EMAIL_TO` through the configured SMTP sender. A successful email
submission is audited as `accepted` by the SMTP server, not as proof of mailbox
delivery, and does not rewrite an SMS attempt as delivered. If SMTP is not
configured, Fred must record that fallback as unavailable and surface it in
service logs without including addresses or phone numbers.

Every enabled worker tick also reconciles durable transition history. An outage
or recovery with no SMS row, or with a failed/unknown SMS and no audited email
fallback, receives one idempotently claimed email attempt. If Telnyx
configuration is unavailable, only never-submitted `queued` SMS rows are marked
failed before reconciliation; `sending` and `accepted` rows are never resent.
Stale `sending` SMS and SMTP rows become `unknown` after two minutes. Fred does
not automatically retry either ambiguous channel. SMTP connection, greeting,
and socket waits are bounded so a broken mail server cannot hang a worker
indefinitely.

An `email_not_configured` audit is also final for that historical transition;
Fred intentionally does not deliver old outage/recovery pairs later merely
because SMTP was subsequently configured. Operators should correct email
configuration and use the labeled test before enabling new alert traffic.

## Operations and rollback

Use database state and service logs together; neither alone proves delivery.
The normal checks are:

```bash
sudo systemctl status sccc-api --no-pager
sudo journalctl -u sccc-api --since "15 minutes ago" --no-pager
```

Redact recipient details before sharing output. Inspect active incidents,
latest observations, counters, suppressions, and delivery status in PostgreSQL
using a read-only session. A provider status of `accepted` is not the same as
`delivered`.

For an unexpected alert burst, set `FRED_ALERT_ENABLED=false`, restart
`sccc-api`, and confirm the worker has stopped. Then disable the affected
anchor rows or add a documented maintenance window before investigating the
evidence. Do not delete incidents or delivery history to silence alerts.

Application rollback is the normal deployment rollback to the previous tested
commit. Keep the additive alert tables in place unless a separately reviewed
database rollback is required; older application versions ignore them, while
retaining the audit trail. Rolling code back does not revoke the Telnyx key. If
the credential may have been exposed, revoke it in Telnyx, replace the
root-owned secret, restart the service, and repeat the labeled test before
reenabling alerts.
