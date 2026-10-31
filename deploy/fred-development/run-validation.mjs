import { spawnSync } from 'node:child_process';
import { statSync } from 'node:fs';
const root = '/var/lib/fred-development/workspace';
const steps = [
  ['Sandbox boundaries', 'artifacts/api-server', ['/opt/fred-development/sandbox-check.mjs']],
  ['API acceptance tests', 'artifacts/api-server', ['node_modules/vitest/vitest.mjs','run','--configLoader','runner','--no-cache','src/lib/fred_page_context.test.ts','src/lib/fred_app_catalog.test.ts','src/lib/fred_development.test.ts','src/lib/fred_coding_request.test.ts','src/lib/building_performance.test.ts','src/lib/building_service_evidence.test.ts','src/lib/wallboard_performance.test.ts']],
  ['Frontend production build', 'artifacts/it-reporting', ['node_modules/vite/bin/vite.js','build','--config','vite.config.ts','--configLoader','runner']],
  ['Backend production build', 'artifacts/api-server', ['build.mjs']],
];
for (const [label, directory, args] of steps) {
  console.log(`CHECK: ${label}`);
  const result = spawnSync('/usr/bin/node', args, { cwd: `${root}/${directory}`, stdio: 'inherit', env: { PATH:'/usr/bin:/bin', HOME:'/tmp', BASE_PATH:'/', NODE_ENV:label.includes('build')?'production':'test', CI:'true' }, timeout:180000 });
  if (result.error || result.status !== 0) { console.error(`FAILED: ${label}`); process.exit(1); }
}
for (const file of ['artifacts/it-reporting/dist/public/index.html','artifacts/api-server/dist/index.mjs']) {
  if (statSync(`${root}/${file}`).size < 100) throw new Error(`Missing build output: ${file}`);
}
console.log('ACCEPTANCE_PASSED');
