import { spawn } from 'node:child_process';
const cwd = '/home/scccadmin/fred-device-performance-20261025/build/artifacts/it-reporting';
const base = 'http://127.0.0.1:18641';
const preview = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--config', 'vite.config.ts', '--host', '127.0.0.1', '--port', '18641', '--strictPort'], { cwd, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, PORT: '18641', BASE_PATH: '/' } });
preview.stderr.on('data', value => process.stderr.write(value));
try {
  let ready = false;
  for (let attempt = 0; attempt < 40; attempt++) {
    try { ready = (await fetch(base)).ok; } catch {}
    if (ready) break;
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  if (!ready) throw new Error('Loopback fixture preview did not start');
  const child = spawn(process.execPath, ['node_modules/@playwright/test/cli.js', 'test', 'tests/building-diagnostics.spec.ts', '--reporter=list'], { cwd, stdio: 'inherit', env: { ...process.env, E2E_BASE_URL: base, PLAYWRIGHT_BROWSERS_PATH: '/home/scccadmin/fred-device-performance-20261025/.playwright-cache' } });
  const result = await new Promise(resolve => child.on('exit', code => resolve(code ?? 1)));
  process.exitCode = result;
} finally { preview.kill('SIGTERM'); }
