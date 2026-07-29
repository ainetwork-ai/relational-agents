// Relationship-agent dashboard server — zero dependencies, plain Node.
//
//   node server.mjs
//
// Reads the girlfriends database (a CSV named like "Relationships") straight
// from the workspace app’s OKF store (OKF_ROOT), so the workspace table and
// this dashboard are two views over the same file. Seeds a demo CSV with
// today-relative dates on first run if none exists.

import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { fileURLToPath } from "node:url";
import { parseCsv } from "./lib/csv.mjs";
import {
  LEVELS,
  RELATIONSHIPS_DB_RE,
  buildAlerts,
  decorate,
  relationshipsFromGrid,
  seedRelationshipsCsv,
} from "./lib/relationship.mjs";
import { fetchGfRelationships } from "./lib/memory-pages.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.DASH_PORT || 3110);

/** The workspace app’s content root: explicit env wins, then whatever the app
 *  itself is configured with (app/.env.local), then the repo-root fallback —
 *  so both apps always read the same files without extra setup. */
function resolveFsRoot() {
  if (process.env.OKF_ROOT) return path.resolve(process.env.OKF_ROOT);
  try {
    const env = fs.readFileSync(path.join(HERE, "..", "app", ".env.local"), "utf8");
    const m = env.match(/^OKF_ROOT=(.+)$/m);
    if (m) return path.resolve(m[1].trim());
  } catch {
    // no app env file — fall through
  }
  return path.join(HERE, "..", "okf-fs");
}
const FS_ROOT = resolveFsRoot();
// the workspace app app, for "open this row in the app" deep links
const APP_URL = (process.env.MEMORY_BASE_URL || "http://localhost:3000").replace(/\/$/, "");

// ---- locating the database in the OKF tree --------------------------------

/** Recursively find the relationships CSV; returns a posix rel path or null. */
function findRelationshipsCsv(dir = FS_ROOT, rel = "") {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return null;
  }
  for (const e of entries) {
    if (e.name.startsWith(".")) continue;
    const childRel = rel ? `${rel}/${e.name}` : e.name;
    if (e.isFile() && /\.csv$/i.test(e.name) && !/_all\.csv$/i.test(e.name) && RELATIONSHIPS_DB_RE.test(e.name)) {
      return childRel;
    }
    if (e.isDirectory()) {
      const hit = findRelationshipsCsv(path.join(dir, e.name), childRel);
      if (hit) return hit;
    }
  }
  return null;
}

/** The exported-view CSV is the node's identity, but when a `_all.csv` full
 *  export sits beside it, that file is the real data backend (OKF rule). */
function dataFileFor(relPath) {
  const all = relPath.replace(/\.csv$/i, "_all.csv");
  return fs.existsSync(path.join(FS_ROOT, all)) ? all : relPath;
}

/** OKF page id — base64url of the posix rel path (`#rowN` for a row page). */
function okfId(relPath) {
  return Buffer.from(relPath, "utf8").toString("base64url");
}

/** Profile photo: public/avatars/<lowercased name>.(png|jpg|jpeg|webp), if present. */
function avatarFor(name, suffix = "") {
  for (const ext of ["png", "jpg", "jpeg", "webp"]) {
    const rel = `avatars/${name.toLowerCase()}${suffix}.${ext}`;
    if (fs.existsSync(path.join(HERE, "public", rel))) return `/${rel}`;
  }
  return null;
}

function withMedia(r) {
  const key = r.avatarKey ?? r.name;
  return { ...r, avatar: avatarFor(key), cutout: avatarFor(key, "-cutout") };
}

/** Date-course photo log (public/date/dates.json + converted jpgs in
 *  public/date/web). Grouped by EXIF time into courses, hand-assigned to a
 *  girlfriend (matched via avatarKey — stable across UI languages). */
function datesFor(key, lang) {
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(path.join(HERE, "public", "date", "dates.json"), "utf8"));
  } catch {
    return [];
  }
  return (manifest.courses ?? [])
    .filter((c) => c.girlfriend === key)
    .map((c) => ({
      id: c.id,
      date: c.date,
      timeRange: c.timeRange,
      rows: c.rows, // optional photo-grid layout hint (subject grouping)
      title: c.title[lang] ?? c.title.en,
      photos: c.photos.map((p) => ({
        url: `/date/web/${p.file}`,
        time: p.time,
        caption: p.caption[lang] ?? p.caption.en,
      })),
    }))
    .sort((a, b) => b.date.localeCompare(a.date));
}

function buildFromCsv(today, lang) {
  let relPath = findRelationshipsCsv();
  if (!relPath) {
    relPath = "Relationships.csv";
    fs.writeFileSync(path.join(FS_ROOT, relPath), seedRelationshipsCsv(today), "utf8");
    console.log(`seeded demo data → ${path.join(FS_ROOT, relPath)}`);
  }
  const grid = parseCsv(fs.readFileSync(path.join(FS_ROOT, dataFileFor(relPath)), "utf8"));
  const relationships = relationshipsFromGrid(grid).map((r) =>
    withMedia({ ...decorate(r, today, lang), appUrl: `${APP_URL}/p/${okfId(`${relPath}#${r.rowId}`)}` })
  );
  return { source: "csv", dbPath: relPath, dbAppUrl: `${APP_URL}/p/${okfId(relPath)}`, relationships };
}

/** Primary source: the team's gf-record pages in the clone (GF_INDEX
 *  or a page titled "Relationship Records"). Falls back to the OKF CSV. */
async function buildFromMemoryPages(today, lang) {
  const got = await fetchGfRelationships(APP_URL, process.env.GF_INDEX || null, today, lang);
  if (!got) return null;
  const relationships = got.relationships.map((r) =>
    withMedia({
      ...decorate(r, today, lang),
      appUrl: `${APP_URL}/p/${r.rowId}`,
      dates: datesFor(r.avatarKey ?? r.name, lang),
    })
  );
  return {
    source: "memory-pages",
    dbPath: `Relationship Records (${got.relationships.length} pages)`,
    dbAppUrl: `${APP_URL}/p/${got.indexId}`,
    relationships,
  };
}

const cache = new Map(); // lang → { at, data }

async function buildDashboard(lang = "en") {
  const hit = cache.get(lang);
  if (hit && Date.now() - hit.at < 10_000) return hit.data;
  const today = new Date();
  let base = null;
  try {
    base = await buildFromMemoryPages(today, lang);
  } catch (err) {
    console.error(`app-pages source failed (${err.message}) — falling back to CSV`);
  }
  base ??= buildFromCsv(today, lang);
  const data = {
    ...base,
    lang,
    generatedAt: today.toISOString(),
    levels: LEVELS,
    alerts: buildAlerts(base.relationships, today, lang),
  };
  cache.set(lang, { at: Date.now(), data });
  return data;
}

// ---- http -------------------------------------------------------------------

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
};

function serveStatic(res, urlPath) {
  let decoded = urlPath;
  try {
    decoded = decodeURIComponent(urlPath); // avatar filenames can be Korean
  } catch {
    // keep raw path
  }
  const clean = path.posix.normalize(decoded).replace(/^\/+/, "") || "index.html";
  const abs = path.join(HERE, "public", clean);
  if (!abs.startsWith(path.join(HERE, "public")) || !fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
    // SPA fallback: hash routing lives in index.html
    const index = path.join(HERE, "public", "index.html");
    res.writeHead(200, { "content-type": MIME[".html"] });
    res.end(fs.readFileSync(index));
    return;
  }
  res.writeHead(200, { "content-type": MIME[path.extname(abs)] ?? "application/octet-stream" });
  res.end(fs.readFileSync(abs));
}

const server = http.createServer((req, res) => {
  const { pathname, searchParams } = new URL(req.url, `http://${req.headers.host}`);
  (async () => {
    if (pathname === "/api/dashboard") {
      const lang = ["en", "pt"].includes(searchParams.get("lang")) ? searchParams.get("lang") : "en";
      const data = await buildDashboard(lang);
      res.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
      res.end(JSON.stringify(data));
      return;
    }
    serveStatic(res, pathname);
  })().catch((err) => {
    console.error(err);
    res.writeHead(500, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: String(err?.message ?? err) }));
  });
});

server.listen(PORT, () => {
  console.log(`relationship dashboard → http://localhost:${PORT}`);
  console.log(`  data root: ${FS_ROOT}`);
  console.log(`  app:    ${APP_URL}`);
});
