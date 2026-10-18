// Copies the shared, pure simulation engine and seed data into the Supabase
// Edge Functions bundle. Run this before `supabase functions deploy`.
//
// The Edge Functions must use exactly the same engine as the browser so that
// server-authoritative results match what players see locally. Relative imports
// are rewritten with explicit `.ts` extensions because Deno's module loader
// requires them (the Vite build resolves extensionless imports fine).
import { cpSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const shared = join(root, "supabase", "functions", "_shared");

function addExtensions(dir) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      addExtensions(path);
      continue;
    }
    if (!path.endsWith(".ts")) continue;
    const source = readFileSync(path, "utf8");
    const rewritten = source.replace(/(["'])(\.{1,2}\/[^"']*)\1/g, (match, quote, spec) =>
      /\.(ts|tsx|js|json|mjs)$/.test(spec) ? match : `${quote}${spec}.ts${quote}`,
    );
    if (rewritten !== source) writeFileSync(path, rewritten);
  }
}

mkdirSync(shared, { recursive: true });
for (const dir of ["engine", "data"]) {
  const from = join(root, "src", dir);
  const to = join(shared, dir);
  rmSync(to, { recursive: true, force: true });
  cpSync(from, to, { recursive: true });
  addExtensions(to);
  console.log(`synced src/${dir} -> supabase/functions/_shared/${dir}`);
}
console.log("Engine sync complete.");
