import { test } from 'node:test';
import assert from 'node:assert/strict';
import { editablePath } from './policy.mjs';
test('allows application changes including Fred prompts and chat UI', () => {
  for (const p of ['artifacts/it-reporting/src/pages/dashboard.tsx','artifacts/api-server/src/lib/ai_knowledge.ts','artifacts/api-server/src/routes/status_report.ts','docs/feature.md']) assert.equal(editablePath(p), true, p);
});
test('rejects escape, secrets, security, dependencies, deployment and acceptance changes', () => {
  for (const p of ['../outside.ts','/etc/passwd','artifacts/../outside.ts','artifacts/it-reporting/src/../../x.ts','artifacts/it-reporting/src/.env','artifacts/api-server/src/routes/auth.ts','artifacts/api-server/src/lib/entra.ts','artifacts/api-server/src/lib/fred_development.ts','artifacts/api-server/src/routes/index.ts','artifacts/it-reporting/src/context/AuthContext.tsx','lib/db/src/schema/sessions.ts','artifacts/api-server/src/lib/foo.test.ts','deploy/deploy.sh','node_modules/foo.js','package.json']) assert.equal(editablePath(p), false, p);
});
