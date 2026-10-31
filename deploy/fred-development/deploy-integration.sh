#!/usr/bin/env bash
set -euo pipefail
prod=/home/scccadmin/apps/Network-Insight-Hub
work=/var/lib/fred-development/workspace
backup=/home/ITADMIN/releases/fred-20261030-usability/before-development
node --input-type=module - <<'JS'
import fs from 'node:fs';
const latest=JSON.parse(fs.readFileSync('/var/lib/fred-development/control/latest.json','utf8'));
if(latest.status!=='passed'||!latest.sourceUnchanged)throw new Error('Validated unchanged source required');
console.log('Deploying validated integration',latest.id);
JS
mkdir "$backup"
cp -a "$prod/artifacts/api-server/dist" "$backup/backend"
cp -a "$prod/artifacts/it-reporting/dist/public" "$backup/frontend"
cp -a "$work/artifacts/api-server/dist/." "$prod/artifacts/api-server/dist/"
cp -a "$work/artifacts/it-reporting/dist/public/assets/." "$prod/artifacts/it-reporting/dist/public/assets/"
cp "$work/artifacts/it-reporting/dist/public/index.html" "$prod/artifacts/it-reporting/dist/public/index.html"
systemctl restart sccc-api
healthy=false
for attempt in $(seq 1 15);do
  if curl -fsS http://127.0.0.1:8080/api/healthz | grep -q '"status":"ok"';then healthy=true;break;fi
  sleep 2
done
if [ "$healthy" != true ];then
  cp -a "$backup/backend/." "$prod/artifacts/api-server/dist/"
  cp -a "$backup/frontend/." "$prod/artifacts/it-reporting/dist/public/"
  systemctl restart sccc-api
  echo 'Integration reverted after failed health check';exit 1
fi
for file in artifacts/api-server/src/lib/ai_knowledge.ts artifacts/api-server/src/lib/fred_development.ts artifacts/api-server/src/lib/fred_app_catalog.ts artifacts/api-server/src/routes/fred_development.ts artifacts/api-server/src/routes/index.ts artifacts/api-server/src/routes/status_report.ts artifacts/it-reporting/src/pages/ai-report/index.tsx artifacts/it-reporting/src/pages/ai-report/development-tab.tsx;do
  mkdir -p "$backup/source/$(dirname "$file")"
  if [ -f "$prod/$file" ];then cp "$prod/$file" "$backup/source/$file";fi
  cp "$work/$file" "$prod/$file"
done
echo DEVELOPMENT_INTEGRATION_DEPLOYED_HEALTHY
