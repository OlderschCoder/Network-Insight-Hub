# Fred application capability catalog

Fred's application guidance is release-owned rather than inferred from old chat
history. The authoritative catalog lives in
`artifacts/api-server/src/lib/fred_app_catalog.ts` and records every routable
Insights surface, its navigation location, access boundary, functions, actions
Fred can perform, and actions that remain user-controlled.

## Operating contract

When a user asks where a feature lives, what a page does, who can use it, how to
complete a workflow, or whether Fred can perform an action, Fred calls
`get_application_guidance` first. The tool accepts a page name, route, feature,
or workflow. An exact concrete URL is matched to parameterized routes such as
`/risks/:id/edit`.

The catalog separates knowledge from authority:

- **Fred can perform** lists operations backed by an approved tool for the
  signed-in role. Existing role checks, exact confirmation, audit, limits, and
  integration controls still apply.
- **Fred must guide** lists page-controlled operations. Fred returns the exact
  route and click path and states that the user must complete the operation.
- Knowing that a function exists never grants a write permission and never
  authorizes Fred to imitate a successful action.

Calling the guidance tool without a topic returns a compact inventory of every
page. A focused query returns the full function and execution boundary for the
matching page. Broader workflow entries remain seeded for questions that span
several pages.

## Keeping the catalog current

Every frontend route declared in `artifacts/it-reporting/src/App.tsx` must be
owned by exactly one catalog entry. The catalog test reads the route declarations
and fails when a new page is added without Fred guidance. When a page gains or
loses a function, update its `functions`, `fredDirect`, and `fredGuides` fields in
the same change.

The server seeds the catalog into Fred's governed application knowledge during
startup, while the tool reads the release-owned catalog directly. That gives
Fred an immediately correct answer even if a database seed from an older build
still exists during deployment.

Student and employee identity recovery remains a separate security boundary.
The catalog directs users to OnlineKiosk but does not claim Fred can reset or
unlock an account until a least-privilege broker, independent identity proof,
role policy, and audit path are implemented and approved.

See [fred-application-guidance-flow.mmd](fred-application-guidance-flow.mmd) for
the decision flow.
