import path from 'node:path';
export function editablePath(value) {
  if (typeof value !== 'string' || value.length > 300 || value.includes('\\') || value.includes('\0')) return false;
  if (path.posix.normalize(value) !== value || value.startsWith('/') || value.split('/').some(p => p.startsWith('.'))) return false;
  if (!/^(artifacts\/(api-server|it-reporting)\/src\/|lib\/[a-z-]+\/src\/|docs\/)/.test(value)) return false;
  if (!/\.(ts|tsx|js|jsx|css|md|html|json)$/.test(value)) return false;
  // Security, credentials, independent acceptance and the bridge remain outside Fred's edit boundary.
  if (/(^|\/)(auth|entra|identity|security|permission|session|fred_development|fred-development|network_tools_policy|fred_confirmation|inventory|users|admin|AuthContext|authFetch)[^/]*\//i.test(value)) return false;
  if (/(^|\/)(auth|entra|identity|security|permission|session|fred_development|fred-development|network_tools_policy|fred_confirmation|inventory|users|admin|AuthContext|authFetch)[^/]*\.[^.]+$/i.test(value)) return false;
  if (/\.(test|spec)\./.test(value) || /(^|\/)(tests|seeds|generated)\//.test(value)) return false;
  if (value === 'artifacts/api-server/src/routes/index.ts' || value === 'artifacts/api-server/src/index.ts') return false;
  return true;
}
export const shaPattern = /^[a-f0-9]{64}$/;
