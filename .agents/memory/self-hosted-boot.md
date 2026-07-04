---
name: self-hosted boot / optional integrations
description: Why third-party SDK clients must be lazily constructed so the API server boots on self-hosted deployments without every integration key.
---

# Self-hosted boot & optional integrations

- **Never construct a third-party SDK client at module scope if its constructor throws when credentials are missing.** The OpenAI SDK (`new OpenAI({apiKey})`) throws synchronously at import if the key is unset. A top-level `const client = new OpenAI(...)` therefore crashes the whole Express app at startup — under systemd it crash-loops and nginx serves 502 for everything (not just AI routes).
  - **Why:** the Replit dev/prod env has `AI_INTEGRATIONS_OPENAI_*` set, so this stays invisible until someone self-hosts (e.g. the SCCC Azure VM) where those vars don't exist. Symptom was "can't log in" but the real cause was the backend never staying up.
  - **How to apply:** wrap optional integrations in a lazy accessor lib (see `artifacts/api-server/src/lib/openai.ts`: `isAIConfigured()` + cached `getOpenAI()` that throws only when *called* unconfigured). Guard each route with `isAIConfigured()` → 503, and call the getter at request time. This matches the existing NOT_CONFIGURED pattern for FortiGate / Azure / SMTP.

- **Replit AI features use the integrations proxy env (`AI_INTEGRATIONS_OPENAI_API_KEY` + `AI_INTEGRATIONS_OPENAI_BASE_URL`), not a raw `OPENAI_API_KEY`.** Self-hosted boxes have neither, so AI endpoints there return 503 unless the operator supplies their own OpenAI key + base URL in the service env file.

- **Self-hosted (Azure VM) run model:** systemd unit `sccc-api` runs `node artifacts/api-server/dist/index.mjs` from `/opt/sccc-it`, env from `/opt/sccc-it/.env.production`, nginx proxies `/api/` → `localhost:8080`, frontend served static. A 502 on `/api/*` while `GET /` is 200 means the Node backend is down — check `journalctl -u sccc-api`.
  - **Config for the live site lives in `/opt/sccc-it/.env.production`, NOT the Replit Secrets tab.** Replit Secrets only reach the Replit-hosted copy; the VM reads its own env file (confirm the exact path with `grep -i EnvironmentFile /etc/systemd/system/sccc-api.service`). Restart `sccc-api` after editing.

- **Getting real HTTPS on the VM without touching on-prem DNS:** Entra SSO redirect URIs must be HTTPS (bare `http://<ip>` is rejected). You do NOT need a registered public domain — set a **DNS name label** on the VM's Azure Public IP to get a free publicly-resolvable name (`<label>.<region>.cloudapp.azure.com`), open NSG ports 80/443, then `certbot --nginx -d <that name>` issues a trusted Let's Encrypt cert. This sidesteps the college's on-prem nameservers entirely.
  - **Why:** the earlier note "HTTPS is optional / can't be issued for a bare IP" is superseded — HTTPS became mandatory for Entra SSO, and the cloudapp.azure.com label makes it obtainable.
  - **How to apply:** serve the app at the **root** of that hostname (the SPA is built root-based); redirect URI is `https://<label>.<region>.cloudapp.azure.com/api/auth/entra/callback`, registered identically in the Entra app registration. Avoid a `/IT_Reporting`-style sub-path proxy — it reopens the base-path rebuild problem.
