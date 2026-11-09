// Packs dist/client into the Worker as Data modules and writes dist/embedded/.
// Use it when Workers static-asset upload is not available (for example, when
// the API token is injected by a proxy that replaces the upload JWT).
// Usage: node scripts/build-embedded-worker.mjs   (after `npm run build`)
// Env:   WORKER_NAME, D1_DATABASE_ID, D1_DATABASE_NAME, WORKER_VARS (JSON object of plain vars),
//        PLACEMENT_REGION (default aws:ap-southeast-1, next to the D1 primary in SIN; "none" turns it off)
//
// Static responses get an ETag (304 on If-None-Match) and a cache policy:
//   /_next/static/*              1 year, immutable (file names carry a hash)
//   images and fonts             1 day
//   everything else              revalidate every time (cheap 304)
// Rules in dist/client/_headers are applied on top (same syntax as Workers assets).
import { cpSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
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
  ".woff2": "font/woff2", ".otf": "font/otf", ".txt": "text/plain; charset=utf-8",
  ".html": "text/html; charset=utf-8",
};
const longLived = new Set([".png", ".svg", ".ico", ".woff2", ".otf", ".jpg", ".jpeg", ".webp"]);

// Minimal _headers parser: "pattern" lines followed by indented "Name: value" lines.
const headerRules = [];
if (existsSync(join(client, "_headers"))) {
  let current = null;
  for (const line of readFileSync(join(client, "_headers"), "utf8").split("\n")) {
    if (!line.trim() || line.trim().startsWith("#")) continue;
    if (!/^\s/.test(line)) { current = { pattern: line.trim(), headers: {} }; headerRules.push(current); continue; }
    const i = line.indexOf(":");
    if (current && i > 0) current.headers[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
}
const matches = (pattern, path) => pattern.endsWith("*") ? path.startsWith(pattern.slice(0, -1)) : pattern === path;

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
  const cache = urlPath.startsWith("/_next/static/")
    ? "public, max-age=31536000, immutable"
    : longLived.has(extname(file)) ? "public, max-age=86400" : "public, max-age=0, must-revalidate";
  const headers = { "Cache-Control": cache };
  for (const rule of headerRules) if (matches(rule.pattern, urlPath)) Object.assign(headers, rule.headers);
  const etag = `"${createHash("sha256").update(readFileSync(file)).digest("hex").slice(0, 20)}"`;
  entries.push(
    `${JSON.stringify(urlPath)}: { body: f${i}, type: ${JSON.stringify(types[extname(file)] || "application/octet-stream")}, ` +
    `etag: ${JSON.stringify(etag)}, headers: ${JSON.stringify(headers)} }`,
  );
});

writeFileSync(join(out, "__static_manifest.js"), `${imports.join("\n")}\nexport const files = {\n${entries.join(",\n")}\n};\n`);
writeFileSync(join(out, "embedded-entry.js"), `import app from "./index.js";
import { files } from "./__static_manifest.js";
import { AsyncLocalStorage } from "node:async_hooks";
// Server-Timing on /api/* responses: number of D1 round trips and their total time.
const timing = new AsyncLocalStorage();
let patched = false;
function patchD1(db) {
  if (patched || !db) return;
  patched = true;
  const wrap = (proto, name) => {
    const original = proto[name];
    if (typeof original !== "function") return;
    proto[name] = async function (...args) {
      const store = timing.getStore();
      const start = Date.now();
      try { return await original.apply(this, args); }
      finally { if (store) { store.count++; store.ms += Date.now() - start; } }
    };
  };
  try {
    wrap(Object.getPrototypeOf(db), "batch");
    const statement = Object.getPrototypeOf(db.prepare("SELECT 1"));
    for (const name of ["first", "all", "run", "raw"]) wrap(statement, name);
  } catch {}
}
export default {
  async fetch(request, env, ctx) {
    patchD1(env.DB);
    if (new URL(request.url).pathname.startsWith("/api/")) {
      const store = { count: 0, ms: 0 };
      const start = Date.now();
      const response = await timing.run(store, () => app.fetch(request, env, ctx));
      try {
        const headers = new Headers(response.headers);
        headers.append("Server-Timing", \`d1;desc="\${store.count} queries";dur=\${store.ms}, total;dur=\${Date.now() - start}\`);
        return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
      } catch { return response; }
    }
    if (request.method === "GET" || request.method === "HEAD") {
      let path;
      try { path = decodeURIComponent(new URL(request.url).pathname); } catch { path = ""; }
      const file = files[path];
      if (file) {
        const headers = new Headers({ "Content-Type": file.type, "ETag": file.etag, "X-Robots-Tag": "noindex, nofollow, noarchive" });
        for (const [key, value] of Object.entries(file.headers)) headers.set(key, value);
        const tags = (request.headers.get("If-None-Match") || "").split(",").map((t) => t.trim().replace(/^W\\//, ""));
        if (tags.includes(file.etag)) return new Response(null, { status: 304, headers });
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
// Most admin requests make several D1 round trips. Requests from Korea often land on
// US colos (SEA, LAX) on this plan, so each round trip crossed the Pacific. Running the
// Worker next to D1 makes it one crossing per request instead of one per query.
const placement = process.env.PLACEMENT_REGION ?? "aws:ap-southeast-1";
if (placement && placement !== "none") config.placement = { region: placement };
config.d1_databases = [{ binding: "DB", database_name: dbName, database_id: dbId }];
writeFileSync(join(out, "wrangler.json"), JSON.stringify(config));
console.log(`Embedded ${files.length} static files into ${relative(root, out)} for Worker "${name}".`);
