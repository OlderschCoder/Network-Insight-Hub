# Usage analytics

The analytics page separates measured product engagement from operational records. A ticket, task, risk, project, or other record assigned to a person is not evidence that the person signed in or viewed it.

## Engagement definitions

- **People signed in:** distinct users with a retained authenticated session or a captured engagement event in the selected window.
- **Session starts:** retained authenticated session rows created in the selected window. These are recoverable historically while those rows remain in the database.
- **Page views:** authenticated client-side route transitions captured after this telemetry release.
- **Active minutes:** visible-browser heartbeats captured every 60 seconds. This is an engagement estimate, not payroll-grade timekeeping; background tabs are excluded.
- **Fred messages:** prompts submitted through the Fred page after this telemetry release.
- **Last activity:** latest measured session start or engagement event.

Before this release, the application did not store page views, time on page, or Fred prompt events. The dashboard reports those historical values as zero rather than estimating or inventing them.

## Operational records

The lower dashboard section reports records created or owned in application tables. Some schemas, including tasks, store the assigned owner but no separate creator. These counts are therefore labeled as record portfolios and must not be interpreted as product engagement.

Telemetry contains user identifiers already used by the authenticated application, paths without query strings, event type, bounded duration, and timestamps. It does not capture page content, prompt text, passwords, or URL query parameters.

## Operations

The schema reconciler creates `product_usage_events` and its indexes idempotently during API startup. The client sends authenticated event requests to `/api/analytics/events`. If event delivery fails, normal product use continues; analytics telemetry is best-effort.

Validate a release with API and frontend type checks/builds, confirm the API service is active, then verify that an authenticated page transition creates one `page_view` event and visible time creates bounded heartbeat events.
