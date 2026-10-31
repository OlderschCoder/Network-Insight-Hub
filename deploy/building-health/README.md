# Buildings service-evidence correction — October 31, 2026

This production-specific patch preserves the deployed application, which differs substantially from the GitHub checkout. Do not replace the live files with this branch's similarly named source files. `source-manifest.json` records the original and resulting file hashes; `production.patch` records only the reviewed Buildings changes.

Fred made the source edits through `develop_website`. Independent review reproduced six false positives in the first implementation. The protected acceptance suite was expanded to 36 tests, including 16 service-evidence regression cases, before release.

## Behavior

- Fresh (within 12 hours), successful positive external transfer evidence can establish an observed Internet path despite a failed switch-management probe.
- LibreSpeed evidence must match the collector origin, server ID and method. External HTTPS evidence requires matching probe type, a public HTTPS origin, successful completed transfer and no failure.
- Stale, future, failed, local-only, zero-throughput and unknown-provenance measurements cannot establish Internet availability. Old successes cannot inherit a newer sample timestamp through averaging.
- Device-monitoring warnings remain visible separately. Failed management probes alone mean monitoring needs review, not a proven building-wide outage.
- Summary and detail use the monitored-switch inventory. Map, cards and detail display observation age and tolerate older responses without serviceEvidence.
- Internet measurements do not verify phone service. Operator statements remain dated operational context; this patch does not force buildings green forever.

## Acceptance installation

`acceptance/building_service_evidence.test.ts` belongs at `artifacts/api-server/src/lib/` in the production development workspace. Install it through the trusted operator workflow, add it to protected-paths.json, and commit the test to the workspace baseline before allowing Fred to prepare a release. The protected runner in `deploy/fred-development/run-validation.mjs` invokes it alongside existing tests. Fred cannot modify acceptance tests or the runner.

Before applying this patch elsewhere, compare source hashes and run `git apply --check production.patch`. A mismatch requires a reviewed integration. Validation must pass on the unchanged source revision before publication.

## Verified live release

Release `ee9c97b3-1a80-4710-b869-a4318306c021`, source revision `92f6730fbdd8626850ba942df92ed6e2c99a899f52f40e9be070ef86fe27ab99`, deployed at 2026-10-31T05:24:08Z (00:24 Central). The controller reported DEPLOYED_HEALTHY; `/api/healthz` returned status ok. Validation confirmed 36 passing tests, sandbox boundaries, both production builds, and unchanged source.

Live browser verification confirmed Internet measurement ages and separate device warnings on the Buildings map/cards and Agriculture detail. Baseball Field remains amber for device monitoring with no endpoint baseline; no whole-building outage is asserted. The measurement does not establish phone service. Existing non-blocking build warnings concern source maps and bundle size.
