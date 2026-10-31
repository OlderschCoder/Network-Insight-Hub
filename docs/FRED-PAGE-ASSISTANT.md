# Fred alongside the site

This change makes Fred available from the shared portal header without navigating away from the user's work. The compact assistant reuses the existing authenticated chat, persisted conversation, attachments, inventory review and application action tools.

Users can choose **Explain this page**, **Find information**, or **Add or update**. These prepare an editable question; sending it is still explicit. Closing the panel keeps the mounted conversation and pending request. The full workspace remains available for saved threads, files and reports.

Every chat request now carries a separate `pagePath`. The backend accepts only a bounded internal pathname, strips query strings and fragments, and supplies release-owned documentation for the matching page plus the site directory. Exact record paths remain available for authorized retrieval. Page context does not contain scraped page HTML, unsaved form values or credentials, and never grants record access.

The model is instructed to fetch current evidence, use existing authorized write tools, link successful saved records, and distinguish a draft from a completed write. Where no tool exists, it must prepare a draft and direct the user to the correct form. This does not add blanket database or filesystem access and does not create new write capabilities for unsupported pages.

The home-page prompt handoff now preserves the question verbatim instead of rewriting it as `About [question]:`. The home layout also mounts its existing search dialog, so the keyboard shortcut actually opens it.

## Validation

- Backend page-context and complete-route-catalog tests: 13 passed.
- Backend and frontend production builds passed with local Windows native dependencies supplied outside the repository.
- Mocked browser checks cover page-preserving chat, exact request context, retained conversation after closing, unchanged handoff text, and a phone-sized composer. They do not call production or test live model output.
- The repository-wide TypeScript check remains blocked by unrelated existing errors in network, dashboard types, analytics and other modules. Two pre-existing message-content narrowing errors in the touched Fred chat component were corrected.

## Release boundary

Prepared in an isolated checkout on `codex/fred-page-assistant`. No production services, database records, permissions or deployment settings were changed. Before rollout, reconcile the deployed revision with GitHub main and run the normal release validation. The original working directory contains uncommitted work and was left intact.
