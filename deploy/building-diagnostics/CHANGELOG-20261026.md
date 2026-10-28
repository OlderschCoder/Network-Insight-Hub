# 2026-10-26

- Cleaned the live `A - SCCC Network Overview` Grafana dashboard without changing its UID or root-folder location.
- Reduced 38 panels to 18 operational panels by removing duplicate, hard-coded, and dead-query views.
- Corrected panel names and throughput, latency, packet-loss, CPU, and memory units for executive readability.
- Reflowed the retained campus map, KPIs, trends, building exceptions, power, switch, and device inventory panels.
- Changed refresh from two hours to one minute and moved the dashboard to a version-controlled file provider.
- Preserved a full Grafana database backup and the original live dashboard JSON before provisioning.
- Added explicit ClearPass overall and per-server health panels. Missing/stale nodes are unhealthy; degraded response/timeouts are warning; healthy requires fresh low-latency data with no new timeouts.
- Replaced misleading Grafana default red coloring on neutral client counts with blue and split the ambiguous AP total into labeled `APs Up` and `APs Down` health tiles.
