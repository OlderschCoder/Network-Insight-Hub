# Building diagnostics changes — 2026-10-30

- Clarified the executive network count as **Switches reporting via SNMP (of 48)**. The live 30-minute query returned 43 canonical switches; the five missing telemetry sources were `192.168.2.193`, `192.168.2.40`, `192.168.2.41`, `192.168.2.5`, and `192.168.2.54`. Corrected the thresholds so only 48 is green, 47 is yellow, and fewer than 47 is red.
- Renamed the device coverage stat to **Computers tested in selected time range**. It counts distinct completed MultiStreamV2 results, not enrolled or eligible endpoints.
- Marked request loss and DNS/TCP/TLS/TTFB panels as alternate/external-probe-only. The recurring LibreSpeed V2 job does not emit these fields, so missing current data is no longer presented as a broken or healthy zero.
- Converted Wireless Operations PC download/upload panels to horizontal bar gauges. Each bar now displays building, user, computer, and adapter directly and reduces to the latest point per series.
- Live Grafana updates were applied through the dashboard API, preserving Grafana revision history. Verified versions: Network Overview 6, Device Performance 8, Wireless Operations 5. The updated wireless queries returned 37 labeled endpoint series for both download and upload.
- Targeted verification: 23 building-diagnostics unit tests passed; two environment-dependent tests were skipped.
