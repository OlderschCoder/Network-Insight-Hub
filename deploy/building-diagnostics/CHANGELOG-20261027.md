# Building performance — 2026-10-27

- Replaced the Network Buildings route's duplicate building rules with the shared authoritative campus catalog.
- Added the latest exact-building endpoint result to building summaries and detail responses.
- Added readable download, upload, latency, endpoint and measurement-age displays to `/network/buildings`.
- Ambiguous historical labels such as `Main Campus` and `Technical School` are excluded from per-building performance instead of being guessed.
- Focused API tests and Linux API/UI production builds passed. The recurring private collector remains a separate live dependency; missing or stale evidence is displayed as missing/stale, never healthy.
- Excluded complete-snapshot switch-port FDB observations with more than eight learned unicast MACs from exact endpoint-location evidence while preserving their interface telemetry. This prevents shared downstream paths such as the 158-MAC `SWA-AA105/1/1/51` observation from assigning an entire cohort to one building.
