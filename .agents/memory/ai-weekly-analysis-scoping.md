---
name: AI weekly analysis scoping
description: How "weekly" AI analysis (red flags) should scope operational tables — by open/active status, not by week window.
---

# Scoping "weekly" AI analysis over operational tables

For weekly AI analysis endpoints (e.g. `POST /status-report/red-flags`), do NOT week-window every table.

**Rule:**
- Tasks (`log_items`) and weekly `entries` → scope to the requested `weekOf` (they are genuinely week-owned).
- Risks/issues, incidents (AARs), and projects → scope to **current outstanding state**, not the week:
  - risks: `status != 'closed'` (enum: open/mitigated/closed)
  - AARs: `status != 'closed'` OR `incidentDate` within the week (enum: open/resolved/closed)
  - projects: `status NOT IN ('completed','cancelled')` (enum: planning/in_progress/on_hold/completed/cancelled)
- Label the context fields so the model knows which are week-scoped vs current-state (e.g. `thisWeekTasks` vs `currentlyOpenRisksAndIssues`).

**Why:** A code review initially flagged "not week-windowed" as a bug. But a risk opened last month that is still open IS this week's red flag; pure week windowing would hide exactly what a CIO needs. Scoping by open/active status is the correct semantics for "what should I flag this week."

**How to apply:** Any future "weekly digest / red flags / this-week summary" over these tables should filter by open/active status for state tables and by week for week-owned tables, and make the distinction explicit in the prompt.
