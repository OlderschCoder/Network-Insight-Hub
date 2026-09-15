import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const script = readFileSync(new URL("./deploy.sh", import.meta.url), "utf8");
const requiredMigrations = [
  "add_ai_knowledge_scope.sql",
  "add_device_configs.sql",
  "add_incident_rooms.sql",
  "add_fred_building_alerts.sql",
  "add_fred_building_alert_baseline.sql",
];

const bashExecutable = process.platform === "win32"
  ? [
      "C:\\Program Files\\Git\\bin\\bash.exe",
      "C:\\Program Files (x86)\\Git\\bin\\bash.exe",
    ].find(existsSync)
  : "bash";

function bashPath(path) {
  if (process.platform !== "win32") return path;
  return path
    .replace(/^([A-Za-z]):/, (_, drive) => `/${drive.toLowerCase()}`)
    .replaceAll("\\", "/");
}

function shellQuote(value) {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

test("every migration required by deploy exists in the release", () => {
  for (const migration of requiredMigrations) {
    assert.equal(
      existsSync(new URL(`../lib/db/migrations/${migration}`, import.meta.url)),
      true,
      `missing required migration artifact: ${migration}`,
    );
    assert.match(script, new RegExp(`"${migration.replaceAll(".", "\\.")}"`));
  }
});

test("deploy validates every required migration before applying any SQL", () => {
  const validationLoop = script.indexOf(
    'for migration_name in "${REQUIRED_MIGRATIONS[@]}"; do',
  );
  const missingFileGuard = script.indexOf('if [ ! -f "$sql_file" ]; then');
  const applicationLoop = script.indexOf(
    'for migration_name in "${REQUIRED_MIGRATIONS[@]}"; do',
    validationLoop + 1,
  );
  const psql = script.indexOf(
    'psql -X "$DB_URL" -v ON_ERROR_STOP=1 -f "$sql_file"',
  );

  assert.notEqual(validationLoop, -1);
  assert.notEqual(missingFileGuard, -1);
  assert.notEqual(applicationLoop, -1);
  assert.notEqual(psql, -1);
  assert.ok(validationLoop < missingFileGuard);
  assert.ok(missingFileGuard < applicationLoop);
  assert.ok(applicationLoop < psql);
  assert.match(script, /required migration is missing:[^\n]*\n[^\n]*exit 1/);
});

test(
  "a missing required migration aborts before psql is invoked",
  { skip: !bashExecutable && "bash is required to exercise deploy.sh" },
  (t) => {
    const root = mkdtempSync(join(tmpdir(), "sccc-deploy-test-"));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const source = join(root, "source");
    const destination = join(root, "destination");
    const migrationDir = join(source, "lib", "db", "migrations");
    const deployDir = join(source, "deploy");
    const binDir = join(root, "bin");
    const psqlMarker = join(root, "psql-was-called");
    mkdirSync(migrationDir, { recursive: true });
    mkdirSync(deployDir, { recursive: true });
    mkdirSync(destination, { recursive: true });
    mkdirSync(binDir, { recursive: true });
    copyFileSync(new URL("./deploy.sh", import.meta.url), join(deployDir, "deploy.sh"));
    for (const migration of requiredMigrations.slice(0, -1)) {
      writeFileSync(join(migrationDir, migration), "-- test migration\n");
    }
    writeFileSync(
      join(destination, ".env.production"),
      "DATABASE_URL=postgresql://deploy-test.invalid/test\n",
    );
    writeFileSync(join(binDir, "git"), "#!/usr/bin/env bash\nexit 0\n");
    writeFileSync(
      join(binDir, "psql"),
      '#!/usr/bin/env bash\n: > "$PSQL_MARKER"\nexit 0\n',
    );
    chmodSync(join(binDir, "git"), 0o755);
    chmodSync(join(binDir, "psql"), 0o755);

    const command = [
      `export PATH=${shellQuote(bashPath(binDir))}:$PATH`,
      `export SRC=${shellQuote(bashPath(source))}`,
      `export DEST=${shellQuote(bashPath(destination))}`,
      `export PSQL_MARKER=${shellQuote(bashPath(psqlMarker))}`,
      `bash ${shellQuote(bashPath(join(deployDir, "deploy.sh")))} --skip-import`,
    ].join("; ");
    const result = spawnSync(bashExecutable, ["-c", command], {
      encoding: "utf8",
    });

    assert.notEqual(result.status, 0, result.stdout);
    assert.match(
      result.stderr,
      /required migration is missing:.*add_fred_building_alert_baseline\.sql/,
    );
    assert.equal(existsSync(psqlMarker), false, "psql ran before preflight completed");
  },
);

test("deploy applies the Fred baseline migration after the base alert schema", () => {
  const baseMigration = script.indexOf("add_fred_building_alerts.sql");
  const baselineMigration = script.indexOf("add_fred_building_alert_baseline.sql");

  assert.notEqual(baseMigration, -1);
  assert.notEqual(baselineMigration, -1);
  assert.ok(baseMigration < baselineMigration);
  assert.match(
    script,
    /psql -X "\$DB_URL" -v ON_ERROR_STOP=1 -f "\$sql_file"/,
  );
});
