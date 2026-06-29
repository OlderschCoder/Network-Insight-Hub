---
name: Secrets require workflow restart
description: Changing a Replit secret/env var does not affect an already-running workflow until it is restarted.
---

Replit injects secrets and env vars into a process only at launch. A running
workflow keeps its original `process.env` snapshot; updating a secret in the
Secrets UI (or via requestEnvVar) does NOT change the value seen by an
already-running server.

**Why:** During Azure integration setup, AZURE_* secrets were corrected several
times but the running api-server kept returning the *identical* auth error
because it still held the stale values. Each correction only took effect after
restarting the api-server workflow.

**How to apply:** After any add/change/correction to a secret or env var that
server code reads, restart the relevant workflow before re-testing. Do not tell
the user "no restart needed" for secret value changes — only Azure/RBAC-style
server-side changes (where our env is unchanged) are safe to retest without a
restart.
