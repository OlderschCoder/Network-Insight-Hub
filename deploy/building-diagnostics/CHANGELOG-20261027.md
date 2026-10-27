# Building performance — 2026-10-27

- Replaced the Network Buildings route's duplicate building rules with the shared authoritative campus catalog.
- Added the latest exact-building endpoint result to building summaries and detail responses.
- Added readable download, upload, latency, endpoint and measurement-age displays to `/network/buildings`.
- Ambiguous historical labels such as `Main Campus` and `Technical School` are excluded from per-building performance instead of being guessed.
- Focused API tests and Linux API/UI production builds passed. The recurring private collector remains a separate live dependency; missing or stale evidence is displayed as missing/stale, never healthy.
