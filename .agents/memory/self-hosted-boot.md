---
name: self-hosted boot / optional integrations
description: Why third-party SDK clients must be lazily constructed so the API server boots on self-hosted deployments without every integration key.
---

# Self-hosted boot & optional integrations

- **Never construct a third-party SDK client at module scope if its constructor throws when credentials are missing.** The OpenAI SDK (`new OpenAI({apiKey})`) throws synchronously at import if the key is unset. A top-level `const client = new OpenAI(...)` therefore crashes the whole Express app at startup — under systemd it crash-loops and nginx serves 502 for everything (not just AI routes).
  - **Why:** the Replit dev/prod env has `AI_INTEGRATIONS_OPENAI_*` set, so this stays invisible until someone self-hosts (e.g. the SCCC Azure VM) where those vars don't exist. Symptom was "can't log in" but the real cause was the backend never staying up.
  - **How to apply:** wrap optional integrations in a lazy accessor lib (see `artifacts/api-server/src/lib/openai.ts`: `isAIConfigured()` + cached `getOpenAI()` that throws only when *called* unconfigured). Guard each route with `isAIConfigured()` → 503, and call the getter at request time. This matches the existing NOT_CONFIGURED pattern for FortiGate / Azure / SMTP.

- **Replit AI features use the integrations proxy env (`AI_INTEGRATIONS_OPENAI_API_KEY` + `AI_INTEGRATIONS_OPENAI_BASE_URL`), not a raw `OPENAI_API_KEY`.** Self-hosted boxes have neither, so AI endpoints there return 503 unless the operator supplies their own OpenAI key + base URL in the service env file.

- **Self-hosted (Azure VM) run model:** systemd unit `sccc-api` runs `node artifacts/api-server/dist/index.mjs` from `/opt/sccc-it`, env from `/opt/sccc-it/.env.production`, nginx proxies `/api/` → `localhost:8080`, frontend served static. A 502 on `/api/*` while `GET /` is 200 means the Node backend is down — check `journalctl -u sccc-api`. HTTPS/certbot is optional and can't be issued for a bare IP (needs a real domain); the app works fine over plain HTTP.
