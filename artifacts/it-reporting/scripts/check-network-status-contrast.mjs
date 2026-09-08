import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const cssPath = fileURLToPath(new URL("../src/index.css", import.meta.url));
const css = await readFile(cssPath, "utf8");

const foregrounds = [
  "network-status-title",
  "network-status-meta",
  "network-status-action",
].map((name) => {
  const match = css.match(new RegExp(`--${name}:\\s*(#[0-9a-f]{6})`, "i"));
  assert.ok(match, `Missing --${name} color token`);
  return [name, match[1]];
});

const statusBackgrounds = [
  ["green-50", "#f0fdf4"],
  ["amber-50", "#fffbeb"],
  ["red-50", "#fef2f2"],
  ["gray-50", "#f9fafb"],
];

function relativeLuminance(hex) {
  const channels = hex
    .slice(1)
    .match(/../g)
    .map((value) => Number.parseInt(value, 16) / 255)
    .map((value) => (value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4));

  return (0.2126 * channels[0]) + (0.7152 * channels[1]) + (0.0722 * channels[2]);
}

function contrastRatio(foreground, background) {
  const lighter = Math.max(relativeLuminance(foreground), relativeLuminance(background));
  const darker = Math.min(relativeLuminance(foreground), relativeLuminance(background));
  return (lighter + 0.05) / (darker + 0.05);
}

for (const [foregroundName, foreground] of foregrounds) {
  for (const [backgroundName, background] of statusBackgrounds) {
    const ratio = contrastRatio(foreground, background);
    assert.ok(
      ratio >= 7,
      `${foregroundName} is only ${ratio.toFixed(2)}:1 on ${backgroundName}; expected at least 7:1`,
    );
  }
}

console.log("Network status text contrast passed at 7:1 or better on every health surface.");
