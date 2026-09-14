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
const layoutValidationPath = fileURLToPath(
  new URL("../../api-server/src/lib/building_map_layout.ts", import.meta.url),
);
const buildingAssignmentPath = fileURLToPath(
  new URL("../../api-server/src/lib/building_assignment.ts", import.meta.url),
);
const documentationPath = fileURLToPath(
  new URL("../../../docs/building-first-network-flow.md", import.meta.url),
);
const diagramPath = fileURLToPath(
  new URL("../../../docs/shared-campus-map-flow.mmd", import.meta.url),
);

const [monitoring, buildings, api, layoutValidation, buildingAssignment, documentation, diagram] = await Promise.all([
  readFile(monitoringPath, "utf8"),
  readFile(buildingsPath, "utf8"),
  readFile(apiPath, "utf8"),
  readFile(layoutValidationPath, "utf8"),
  readFile(buildingAssignmentPath, "utf8"),
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
assert.match(buildings, /code:\s*["']MAN["'][^\n]+buildingName:\s*["']Mansions["']/, "Mansions needs a built-in campus-map marker");
assert.match(buildings, /Building visibility/, "The map editor must expose building visibility controls");
assert.match(buildings, /canEditCampusMap\(user\?\.role\)/, "The Edit Map control must follow the CIO role gate");
assert.match(buildings, /layout\[overlay\.code\]\?\.visible\s*!==\s*false/, "The shared display helper must honor saved visibility");
assert.match(buildings, /CUSTOM:\$\{encodeURIComponent\(name\.trim\(\)\)\}/, "Unlisted buildings need stable custom markers");

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
  api,
  /buildingOverlayPutSchema\.safeParse\(req\.body\)/,
  "Map saves must use the shared layout validator",
);
assert.match(
  api,
  /router\.put\(["']\/buildings\/map-layout["'],\s*requireAuth,\s*requireCIO/,
  "Map writes must require CIO authorization",
);
assert.match(
  api,
  /router\.delete\(["']\/buildings\/map-layout["'],\s*requireAuth,\s*requireCIO/,
  "Map resets must require CIO authorization",
);
assert.match(
  layoutValidation,
  /BUILDING_OVERLAY_CODE_MAX_LENGTH\s*=\s*200/,
  "Custom building marker identifiers must fit the documented 200-character contract",
);
assert.match(layoutValidation, /BUILDING_OVERLAY_HIDDEN_PREFIX/, "Visibility must use persisted layout metadata");
assert.match(layoutValidation, /BUILDING_LEGACY_HIDDEN_PREFIX/, "Legacy hidden-building settings must remain readable");
assert.match(layoutValidation, /campusMapOverlayCodeForBuildingName/, "Legacy building names must map to current overlay codes");
assert.match(layoutValidation, /typeof position\.visible === ["']boolean["']/, "Legacy clients that omit visibility must preserve hidden metadata");
assert.match(buildingAssignment, /"Mansions"/, "Mansions must be authoritative");
assert.match(buildingAssignment, /SWA-SLAB|swa slab/i, "SWA-SLAB must map to Mansions");
assert.match(buildingAssignment, /SWA-SLCDE|swa slcde/i, "SWA-SLCDE must map to Mansions");

assert.match(
  documentation,
  /Buildings and Monitoring render the same `CampusStatusMap` component/,
  "The shared campus-map behavior must remain documented",
);
assert.match(
  documentation,
  /URL-encoded\s+`CUSTOM:<building name>` identifiers up to 200 characters/,
  "The custom building marker write contract must remain documented",
);
assert.match(documentation, /Building visibility/, "The operator path for map visibility must be documented");
assert.match(documentation, /Mansions/, "The default Mansions marker must be documented");
assert.match(diagram, /^flowchart\s+LR/m, "The editable Mermaid flow must declare its diagram type");
assert.ok(
  diagram.includes("E -->|PUT built-in and custom positions plus visibility| V"),
  "The diagram must show the editor write path through validation",
);
assert.match(
  diagram,
  /V\[Validate marker code up to 200 chars\]/,
  "The diagram must name the custom marker validation boundary",
);
assert.match(
  diagram,
  /^\s*V\s+-->\s+A/m,
  "The diagram must route validated positions to the canonical API",
);
assert.match(
  diagram,
  /A\s+-->\|GET no-store once, share loaded layout\|\s+M\[Monitoring map, green count, and overall status\]/,
  "The diagram must show Monitoring's canonical read path",
);
assert.match(diagram, /C\[CIO Mark or Tracy\]\s+-->\s+E/, "The diagram must show the CIO editor gate");
assert.match(diagram, /Hidden-marker metadata rows/, "The diagram must show visibility persistence");

console.log("Buildings and Monitoring share one no-cache, auto-refreshing campus-map layout source.");
