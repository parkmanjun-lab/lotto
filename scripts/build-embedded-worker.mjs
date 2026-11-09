// Packs dist/client into the Worker as Data modules and writes dist/embedded/.
// Use it when Workers static-asset upload is not available (for example, when
// the API token is injected by a proxy that replaces the upload JWT).
// Usage: node scripts/build-embedded-worker.mjs   (after `npm run build`)
// Env:   WORKER_NAME, D1_DATABASE_ID, D1_DATABASE_NAME, WORKER_VARS (JSON object of plain vars)
import { cpSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, relative, extname } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const dist = join(root, "dist");
const client = join(dist, "client");
const out = join(dist, "embedded");
const staticDir = join(out, "__static");

const name = process.env.WORKER_NAME || "lotto-notes";
const dbId = process.env.D1_DATABASE_ID;
const dbName = process.env.D1_DATABASE_NAME || "lotto-notes-db";
if (!dbId) throw new Error("Set D1_DATABASE_ID.");

const ignored = new Set(
  readFileSync(join(client, ".assetsignore"), "utf8").split("\n").map((s) => s.trim()).filter(Boolean),
);
ignored.add(".assetsignore");
ignored.add("_headers");

const types = {
  ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".json": "application/json", ".webmanifest": "application/manifest+json",
  ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8", ".html": "text/html; charset=utf-8",
};

function walk(dir) {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

rmSync(out, { recursive: true, force: true });
cpSync(join(dist, "server"), out, { recursive: true });
mkdirSync(staticDir, { recursive: true });

const files = walk(client).filter((f) => !ignored.has(relative(client, f).split("/")[0]));
const imports = [];
const entries = [];
files.forEach((file, i) => {
  const urlPath = "/" + relative(client, file).split("\\").join("/");
  const moduleName = `f${i}.bin`;
  cpSync(file, join(staticDir, moduleName));
  imports.push(`import f${i} from "./__static/${moduleName}";`);
  const immutable = urlPath.startsWith("/_next/static/");
  const extra = {};
  entries.push(
    `${JSON.stringify(urlPath)}: { body: f${i}, type: ${JSON.stringify(types[extname(file)] || "application/octet-stream")}, ` +
    `cache: ${JSON.stringify(immutable ? "public, max-age=31536000, immutable" : "public, max-age=0, must-revalidate")}, ` +
    `extra: ${JSON.stringify(extra)} }`,
  );
});

writeFileSync(join(out, "__static_manifest.js"), `${imports.join("\n")}\nexport const files = {\n${entries.join(",\n")}\n};\n`);
writeFileSync(join(out, "embedded-entry.js"), `import app from "./index.js";
import { files } from "./__static_manifest.js";
export default {
  async fetch(request, env, ctx) {
    if (request.method === "GET" || request.method === "HEAD") {
      let path;
      try { path = decodeURIComponent(new URL(request.url).pathname); } catch { path = ""; }
      const file = files[path];
      if (file) {
        const headers = new Headers({ "Content-Type": file.type, "Cache-Control": file.cache, "X-Robots-Tag": "noindex, nofollow, noarchive" });
        for (const [key, value] of Object.entries(file.extra)) headers.set(key, value);
        return new Response(request.method === "HEAD" ? null : file.body, { headers });
      }
    }
    return app.fetch(request, env, ctx);
  },
};
`);

const config = JSON.parse(readFileSync(join(dist, "server", "wrangler.json"), "utf8"));
config.name = name;
config.topLevelName = name;
config.main = "embedded-entry.js";
delete config.assets;
// *.bin files are Data modules by Wrangler's default rules.
if (process.env.WORKER_VARS) config.vars = { ...(config.vars || {}), ...JSON.parse(process.env.WORKER_VARS) };
config.d1_databases = [{ binding: "DB", database_name: dbName, database_id: dbId }];
writeFileSync(join(out, "wrangler.json"), JSON.stringify(config));
console.log(`Embedded ${files.length} static files into ${relative(root, out)} for Worker "${name}".`);
