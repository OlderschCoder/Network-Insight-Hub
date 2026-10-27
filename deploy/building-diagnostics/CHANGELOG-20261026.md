# 2026-10-26

- Cleaned the live `A - SCCC Network Overview` Grafana dashboard without changing its UID or root-folder location.
- Reduced 38 panels to 18 operational panels by removing duplicate, hard-coded, and dead-query views.
- Corrected panel names and throughput, latency, packet-loss, CPU, and memory units for executive readability.
- Reflowed the retained campus map, KPIs, trends, building exceptions, power, switch, and device inventory panels.
- Changed refresh from two hours to one minute and moved the dashboard to a version-controlled file provider.
- Preserved a full Grafana database backup and the original live dashboard JSON before provisioning.
