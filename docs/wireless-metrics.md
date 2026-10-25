# SCCC wireless metrics

The private NOC collector on `10.0.0.22` collects read-only operational data
from Aruba Mobility Master every two minutes and writes it to the existing
InfluxDB `telegraf` bucket. Mobility Master is the authoritative source for
live AP, client, SSID, radio, building, and controller RADIUS counters.

## Measurements

- `aruba_wireless_summary`: total/guest/authenticated clients, clients without
  IPv4, AP up/down, average/median/p95/max clients per AP, band mix, and RADIUS
  accept/reject/timeout deltas.
- `aruba_wireless_ssid`: client count, no-IPv4 count, and serving APs for SCCC
  Guest, SCCC Wireless, West Wireless, and SCCC IoT.
- `aruba_wireless_building`: clients, guests, authenticated clients, no-IPv4
  clients, AP up/down, and average clients per AP by inferred building.
- `aruba_wireless_ap`: current clients, state, SSID count, group, model, and
  inferred building for each AP.
- `aruba_radius_server`: cumulative counters plus interval deltas and response
  time for the on-prem, VIP, and Azure ClearPass targets.

Building inference uses explicit AP-name rules with AP-group fallback. Every
unmatched AP is reported as `Unknown`; it is never silently assigned to a
building. Update the mapping rules as naming is standardized.

## Important boundary

Mobility Master RADIUS counters provide interval reject and timeout attempts,
not the identity of unique failed users/devices. Unique failed devices,
Access Tracker reasons, ClearPass cluster/replication health, and certificate
health require a separate read-only ClearPass API/syslog integration. Do not
label RADIUS attempt counts as unique users.

## Service operations

```bash
systemctl status sccc-wireless-metrics.timer --no-pager
systemctl status sccc-wireless-metrics.service --no-pager
journalctl -u sccc-wireless-metrics.service -n 50 --no-pager
systemctl start sccc-wireless-metrics.service
```

The root-only environment is `/etc/sccc-wireless-metrics.env`; it must remain
mode `0600`. Aruba credentials and the InfluxDB token are never stored in the
repository or Grafana dashboard.
