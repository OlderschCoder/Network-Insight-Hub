const path = require("node:path");
const { createRequire } = require("node:module");

const sourceRoot = path.resolve(__dirname, "../..");
const fromApi = createRequire(path.join(sourceRoot, "artifacts/api-server/package.json"));

fromApi("esbuild").buildSync({
  entryPoints: [path.join(__dirname, "overnight-librespeed-sweep.ts")],
  bundle: true,
  platform: "node",
  format: "cjs",
  external: ["pg-native"],
  nodePaths: [path.join(sourceRoot, "artifacts/api-server/node_modules")],
  outfile: path.resolve(process.argv[2] || path.join(__dirname, "overnight-librespeed-sweep.cjs")),
  logLevel: "info",
});
