# Building diagnostics changes — 2026-10-30

- Clarified the executive network count as **Switches reporting via SNMP (of 48)**. The live 30-minute query returned 43 canonical switches; the five missing telemetry sources were `192.168.2.193`, `192.168.2.40`, `192.168.2.41`, `192.168.2.5`, and `192.168.2.54`. Corrected the thresholds so only 48 is green, 47 is yellow, and fewer than 47 is red.
- Renamed the device coverage stat to **Computers tested in selected time range**. It counts distinct completed MultiStreamV2 results, not enrolled or eligible endpoints.
- Marked request loss and DNS/TCP/TLS/TTFB panels as alternate/external-probe-only. The recurring LibreSpeed V2 job does not emit these fields, so missing current data is no longer presented as a broken or healthy zero.
- Converted Wireless Operations PC download/upload panels to horizontal bar gauges. Each bar now displays building, user, computer, and adapter directly and reduces to the latest point per series.
- Live Grafana updates were applied through the dashboard API, preserving Grafana revision history. Verified versions: Network Overview 6, Device Performance 8, Wireless Operations 5. The updated wireless queries returned 37 labeled endpoint series for both download and upload.
- Targeted verification: 23 building-diagnostics unit tests passed; two environment-dependent tests were skipped.
- Confirmed the endpoint telemetry gap instead of masking it in Grafana: the preceding 24-hour production window contained 104 validated Ethernet measurements and no Wi-Fi measurements. Recent check-ins did contain active Wi-Fi adapters, but the signed speed helper measures only interfaces that are already up, associated, addressed, have a default gateway, and can route to the pinned LibreSpeed server; it does not enable or connect Wi-Fi.
- Added the full-width **Daily validated speed measurements by adapter** panel to `SCCC Device Performance`. It uses stacked daily bars split by the actual `ethernet` and `wifi` tags and explicitly treats a missing Wi-Fi series as missing collection, not a zero-speed result. The live provisioned dashboard advanced from 23 panels/version 5 to 24 panels/version 9. Backup: `/srv/sccc-ops/backups/20261030T143721Z-daily-device-activity`.
- Live Influx read-back returned only Ethernet series for the current seven-day window, including 25, 67, and 57 measurements in the displayed daily windows. This verifies the dashboard query and also confirms that Wi-Fi collection still requires an eligible Wi-Fi test path rather than a presentation fix.
- Targeted verification after the daily-panel change: 25 building-diagnostics tests passed; two environment-dependent tests were skipped.

## Hourly Wi-Fi building cohort

- Changed the production LibreSpeed schedule from every two hours to every hour, 07:00–19:00 America/Chicago, with no more than three current Wi-Fi endpoints per named building.
- A runnable Wi-Fi endpoint must report an active Wi-Fi adapter with BSSID, default gateway, and a routable IPv4 address. Ethernet-only and APIPA (`169.254.0.0/16`) endpoints are not substituted into this cohort.
- Reduced the recent-job fence and queue lifetime from 110 minutes to 50 minutes so an hourly slot cannot overlap its predecessor.
- Production settings were armed at revision 12 with a 60-minute interval. API health and the persisted settings were read back after the guarded deployment.
- The signed endpoint 1.2.3 pilot completed through the normal server-authorized job path on `SUR-SE`: 231.58 Mbps download, 191.76 Mbps upload, 22.52 ms latency, `SCCC Wireless`, and its current BSSID.
- Five more current Wi-Fi endpoints were upgraded after the pilot. Four completed replayed measurements across Agriculture, Hobble, and Student Living Center; `SUR-POS2NEW` became unreachable while its Student Union job was running and produced no verified result. `SUR-ED` was unreachable by WinRM and remains explicit follow-up rather than an assumed success.
- The private collector exported the completed reports on its normal five-minute cycle. An Influx read-back returned five fresh Wi-Fi rows with building, computer, download, upload, and latency fields; the Grafana dashboard refresh remains 30 seconds.
- Targeted scheduler verification passed 22 tests; the production API build and diff check passed. Full repository tests retained unrelated baseline failures.
