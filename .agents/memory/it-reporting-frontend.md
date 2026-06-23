---
name: it-reporting frontend setup
description: Styling/theming setup gotchas for the it-reporting React app and where the SCCC design system lives.
---

# it-reporting frontend

- **Tailwind v4, CSS-first config.** There is NO `tailwind.config.js`/`postcss.config.js`. Tokens live in `artifacts/it-reporting/src/index.css` via `@theme inline` + `:root`. Briefs that say "add to tailwind.config.js" must be adapted to edit `index.css` instead.
  - **Why:** v4 (`@tailwindcss/vite`) reads theme from CSS. Creating a `tailwind.config.js` would be silently ignored.
  - **How to apply:** to expose a color/radius/shadow as a utility (`bg-forest`, `rounded-brand`, `shadow-brand`), register it under `@theme inline` (`--color-*`, `--radius-*`, `--shadow-*`) mapping to a raw `:root` var.

- **SCCC brand design system** lives in `artifacts/it-reporting/src/components/system/` (AppShell, PageHeader, Card, Button [primary/secondary/ghost], Input, Select, Table, Badge/StatusPill, Stat, Signature; barrel `index.ts`). Brand tokens: forest/forest-2/brand(emerald)/brand-soft(mint)/paper/surface/ink/ink-muted/line. Isolated showcase route: `/design-system`.
  - The app ALSO has a separate shadcn token set (`--primary`, `--background`, etc.) driving `src/components/ui/*` and existing pages. The brand tokens are additive and do NOT remap the shadcn tokens, so existing pages stay visually unchanged until explicitly refactored.

- Footer signature on brand pages: green "MB" monogram + "Built by Dr. Mark Bojeun · SCCC IT" (see `system/Signature.tsx`).
