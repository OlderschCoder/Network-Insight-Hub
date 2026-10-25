# Nightly network telemetry

The authoritative collector runs on `10.0.0.22` from the immutable release
selected by `/opt/sccc-switch-telemetry/current`. The systemd timer starts it
nightly at 03:15 America/Chicago with a stable delay of up to 15 minutes.

Each run validates the canonical scope of 49 switches and two FortiGate
firewalls. All 49 switches are attempted. Successful switch records are audited,
preflighted, and published to Fred even when another switch is unreachable; the
failed records remain in the run audit and the final state becomes
`completed_with_warnings`. A malformed scope or a publish failure still fails
closed.

The two firewalls are polled continuously by Telegraf on `10.0.0.22` (60-second
SNMP inputs). The nightly run uses a read-only InfluxDB token on that same host
to verify that both approved firewalls have recent interface telemetry. A
firewall warning is recorded without discarding healthy switch updates.

Operational files:

- Timer: `/etc/systemd/system/sccc-switch-telemetry.timer`
- Service: `/etc/systemd/system/sccc-switch-telemetry.service`
- Active release: `/opt/sccc-switch-telemetry/current`
- Status: `/var/lib/sccc-switch-telemetry/status.json`
- Latest completed run: `/var/lib/sccc-switch-telemetry/latest`

Run the focused tests with:

```bash
python3 -m unittest -v test_switch_telemetry.py
bash -n run_switch_telemetry.sh
```
