import esbuild from "esbuild";
import { createRequire } from "node:module";
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const outDir = path.join(root, "tmp-dump");
mkdirSync(outDir, { recursive: true });

const builds = [
  { name: "circuits", outfile: path.join(outDir, "circuits.cjs"), entry: path.join(root, "src", "data", "circuits.ts") },
  { name: "rulesets", outfile: path.join(outDir, "rulesets.cjs"), entry: path.join(root, "src", "engine", "rulesets.ts") },
  { name: "teams", outfile: path.join(outDir, "teams.cjs"), entry: path.join(root, "src", "data", "teams.ts") },
  { name: "drivers", outfile: path.join(outDir, "drivers.cjs"), entry: path.join(root, "src", "data", "drivers.ts") },
  { name: "staff", outfile: path.join(outDir, "staff.cjs"), entry: path.join(root, "src", "data", "staff.ts") },
  { name: "sponsors", outfile: path.join(outDir, "sponsors.cjs"), entry: path.join(root, "src", "data", "sponsors.ts") },
];

for (const b of builds) {
  await esbuild.build({
    entryPoints: [b.entry],
    bundle: true,
    format: "cjs",
    platform: "node",
    target: "node18",
    outfile: b.outfile,
    logLevel: "warning",
  });
}

const require = createRequire(import.meta.url);
const dump = (name, obj) => {
  const p = path.join(outDir, `${name}.json`);
  writeFileSync(p, JSON.stringify(obj, null, 0));
  console.log("wrote", p, Array.isArray(obj) ? `[${obj.length}]` : "obj");
};

const circuits = require(path.join(outDir, "circuits.cjs"));
dump("circuits", circuits.CIRCUITS);
const rules = require(path.join(outDir, "rulesets.cjs"));
dump("rulesets", rules.RULESETS);

const teams = require(path.join(outDir, "teams.cjs"));
dump("teams", teams.TEAM_SEEDS);
const drivers = require(path.join(outDir, "drivers.cjs"));
dump("drivers", { fictional: drivers.FICTIONAL_SEEDS, real: drivers.REAL_SEEDS });
const staff = require(path.join(outDir, "staff.cjs"));
dump("staff", { first: staff.FIRST, last: staff.LAST, roles: staff.STAFF_ROLES, core: staff.CORE_ROLES });
const sponsors = require(path.join(outDir, "sponsors.cjs"));
dump("sponsors", sponsors.SPONSORS);
