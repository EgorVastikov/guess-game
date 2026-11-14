import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = fileURLToPath(new URL("..", import.meta.url));
const files = ["dev-local.js"];

function collect(directory) {
  for (const entry of fs.readdirSync(path.join(root, directory), { withFileTypes: true })) {
    const relative = path.join(directory, entry.name);
    if (entry.isDirectory()) collect(relative);
    else if (/\.(?:js|mjs)$/.test(entry.name)) files.push(relative);
  }
}

for (const directory of ["api", "functions", "shared", "public", "scripts", "tests"]) collect(directory);

let failed = false;
function check(label, args, input) {
  const result = spawnSync(process.execPath, args, { input, cwd: root, encoding: "utf8" });
  if (result.status !== 0) {
    failed = true;
    console.error(`Syntax check failed: ${label}\n${result.stderr || result.error?.message || "Unknown error"}`);
  }
}

for (const file of files) check(file, ["--check", file]);
const html = fs.readFileSync(path.join(root, "public/index.html"), "utf8");
let inlineScripts = 0;
for (const [, attributes, source] of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)) {
  if (/\bsrc\s*=/.test(attributes)) continue;
  inlineScripts++;
  const module = /\btype\s*=\s*["']module["']/.test(attributes);
  check(`public/index.html script ${inlineScripts}`, ["--check", "--input-type", module ? "module" : "commonjs"], source);
}
if (!inlineScripts) {
  failed = true;
  console.error("No inline application script found in public/index.html");
}
if (failed) process.exitCode = 1;
else console.log(`Syntax OK: ${files.length} JavaScript files and ${inlineScripts} inline browser module(s).`);
