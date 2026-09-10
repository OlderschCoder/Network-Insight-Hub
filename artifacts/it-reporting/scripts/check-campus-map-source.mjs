import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const monitoringPath = fileURLToPath(
  new URL("../src/components/monitoring/MonitoringDashboard.tsx", import.meta.url),
);
const buildingsPath = fileURLToPath(
  new URL("../src/pages/network/buildings.tsx", import.meta.url),
);
const apiPath = fileURLToPath(
  new URL("../../api-server/src/routes/network_nodes.ts", import.meta.url),
);
const documentationPath = fileURLToPath(
  new URL("../../../docs/building-first-network-flow.md", import.meta.url),
);
const diagramPath = fileURLToPath(
  new URL("../../../docs/shared-campus-map-flow.mmd", import.meta.url),
);

const [monitoring, buildings, api, documentation, diagram] = await Promise.all([
  readFile(monitoringPath, "utf8"),
  readFile(buildingsPath, "utf8"),
  readFile(apiPath, "utf8"),
  readFile(documentationPath, "utf8"),
  readFile(diagramPath, "utf8"),
]);

assert.match(
  monitoring,
  /import\s*\{[^}]*CampusStatusMap[^}]*\}\s*from\s*["']@\/pages\/network\/buildings["']/s,
  "Monitoring must import the canonical Buildings campus-map component",
);
assert.match(
  monitoring,
  /<CampusStatusMap\s+buildings=\{snapshot\.buildings\}/,
  "Monitoring must render the canonical campus map with live building health",
);

assert.match(
  buildings,
  /fetch\(PUBLIC_BUILDINGS_LAYOUT_API,\s*\{\s*cache:\s*["']no-store["']\s*\}\)/s,
  "The public/embedded map must bypass browser layout caching",
);
assert.match(
  buildings,
  /authFetch\(`\$\{API\}\/network\/buildings\/map-layout`,\s*\{[^}]*cache:\s*["']no-store["']/s,
  "The authenticated Buildings and Monitoring map must bypass browser layout caching",
);
assert.match(buildings, /CAMPUS_MAP_LAYOUT_UPDATED_EVENT/, "Map saves must notify open views");
assert.match(buildings, /CAMPUS_MAP_LAYOUT_STORAGE_KEY/, "Map saves must notify other browser tabs");
assert.match(buildings, /CAMPUS_MAP_LAYOUT_REFRESH_MS\s*=\s*30_000/, "Open maps need a bounded refresh fallback");

for (const route of ["/public/buildings/map-layout", "/buildings/map-layout"]) {
  const routeIndex = api.indexOf(`router.get("${route}"`);
  assert.notEqual(routeIndex, -1, `Missing ${route}`);
  const routeBody = api.slice(routeIndex, routeIndex + 260);
  assert.match(
    routeBody,
    /setHeader\(["']Cache-Control["'],\s*["']no-store["']\)/,
    `${route} must prevent proxy/browser caching`,
  );
}

assert.match(
  documentation,
  /Buildings and Monitoring render the same `CampusStatusMap` component/,
  "The shared campus-map behavior must remain documented",
);
assert.match(diagram, /^flowchart\s+LR/m, "The editable Mermaid flow must declare its diagram type");
assert.match(diagram, /E\[Buildings map editor\]\s+-->\|PUT saved positions\|\s+A/, "The diagram must show the editor write path");
assert.match(diagram, /A\s+-->\|GET no-store\|\s+M\[Monitoring CampusStatusMap\]/, "The diagram must show Monitoring's canonical read path");

console.log("Buildings and Monitoring share one no-cache, auto-refreshing campus-map layout source.");
