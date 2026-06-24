---
name: it-reporting frontend setup
description: Styling/theming setup gotchas for the it-reporting React app and where the SCCC design system lives.
---

# it-reporting frontend

- **Tailwind v4, CSS-first config.** There is NO `tailwind.config.js`/`postcss.config.js`. Tokens live in `artifacts/it-reporting/src/index.css` via `@theme inline` + `:root`. Briefs that say "add to tailwind.config.js" must be adapted to edit `index.css` instead.
  - **Why:** v4 (`@tailwindcss/vite`) reads theme from CSS. Creating a `tailwind.config.js` would be silently ignored.
  - **How to apply:** to expose a color/radius/shadow as a utility (`bg-forest`, `rounded-brand`, `shadow-brand`), register it under `@theme inline` (`--color-*`, `--radius-*`, `--shadow-*`) mapping to a raw `:root` var.

- **The whole app is themed by remapping the shadcn semantic tokens** (`--primary`, `--background`, `--card`, `--sidebar`, `--muted`, etc. in `index.css` `:root`) to SCCC HSL values. These drive both `src/components/ui/*` and every page, so a single token change re-themes login + all pages + all shadcn components at once. The additive raw brand vars (`--forest`, `--brand-accent`, etc.) are for the `system/*` primitives and `bg-forest`-style utilities.
  - **How to apply:** for a global look change, edit the `:root` shadcn tokens first. Pages with hardcoded Tailwind colors (status/severity chip maps like `text-red-700`, accent text) still need per-page fixes — those don't follow tokens.

- **SCCC brand = the documented "Saints green" design system from the user's attached brief zip (`SCCC-design-system-brief.md` + `brand-systems.html`), NOT the literal sccc.edu website colors.** Canonical palette: forest `#14361F`, forest-2 `#1B4332`, emerald `#2FAE6B` (reserved for actions / live status), mint `#6FD6A6`, paper `#F6F8F7`, surface `#FFFFFF`, ink `#0B1220`, ink-muted `#5A6472`, line `#E5E8EC`; Inter; radius 10px; faint shadow.
  - **Why:** the brief's emerald is a deliberate stylized palette. An attempt to substitute website-scraped greens (#034638/#006747/#61CE70) was rejected by the user — the zip brief is the source of truth. Do NOT swap brief hexes for website-scraped ones.

- **Action emerald is darkened for contrast.** Brand emerald `#2FAE6B` (`--brand-accent`) fails WCAG AA with white text (~2.8:1), so actionable button fills use `--brand-strong` `#157A48` and shadcn `--primary` is `150 71% 28%` (both ~5:1 with white). Keep `#2FAE6B` for swatches, soft fills, live-status dots, charts — not for white-on-color button text.

- **Dark mode is latent.** No theme toggle adds `.dark` to the document, so `:root` (light) is always active. The `.dark` block in `index.css` is kept as a Saints-green variant for safety but is not exercised.

- The maker's-mark footer signature (`system/Signature.tsx`) is mounted in `layout.tsx` so it shows on every authenticated page; the sidebar header uses the white SCCC logo on the forest background. SCCC logo assets live in `src/assets/brand/`.
