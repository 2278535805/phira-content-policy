/**
 * Scrape the NanameHacha.Dev "Original Music List" page and emit TOML track
 * files under data/rights_holders/naname_hacha/.
 *
 * The page (English version) renders a single HTML <table> with columns:
 *   Track Name | Composer | Album | Listen
 * Each data row carries a BiliBili link in the Listen cell. We map that to:
 *   name     <- Track Name
 *   artist   <- Composer
 *   songPack <- Album
 *   preview  <- BiliBili URL
 *
 * Tracks are grouped into one .toml file per distinct Album value so the
 * output mirrors how other rights holders (lowiro, vivid_stasis) split by
 * song pack.
 *
 * Usage:
 *   pnpm tsx scripts/scrape-naname-hacha.ts            # interactive (default)
 *   pnpm tsx scripts/scrape-naname-hacha.ts -y         # accept all writes
 *   pnpm tsx scripts/scrape-naname-hacha.ts --dry-run  # print, don't write
 *
 * Run from the web/ workspace (where tsx + smol-toml are installed).
 */
import { readFile, writeFile, readdir, mkdir, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline/promises";

const PAGE_URL =
  "https://docs.nanamehacha.dev/en/alice_in_cradle/license/the_use_of_game_assets/music_list";

/** Repo data dir for the naname_hacha rights holder. */
const DATA_DIR = resolve(import.meta.dirname, "..", "..", "data", "rights_holders", "naname_hacha");

interface Row {
  name: string;
  artist: string;
  album: string;
  url: string | null;
}

// --- args -------------------------------------------------------------------

function parseArgs(argv: string[]): { yes: boolean; dryRun: boolean } {
  let yes = false;
  let dryRun = false;
  for (const a of argv.slice(2)) {
    if (a === "-y" || a === "--yes") yes = true;
    else if (a === "--dry-run") dryRun = true;
    else {
      console.error(`unknown arg: ${a}`);
      console.error("usage: tsx scripts/scrape-naname-hacha.ts [-y|--yes] [--dry-run]");
      process.exit(2);
    }
  }
  return { yes, dryRun };
}

// --- fetch + parse ----------------------------------------------------------

/** Decode HTML entities for the small set we actually encounter. */
function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)));
}

/** Strip tags then decode entities. Used on every cell, so kept as a helper. */
function stripTags(html: string): string {
  return decodeEntities(html.replace(/<[^>]+>/g, ""));
}

function parseTable(html: string): Row[] {
  const tableMatch = html.match(/<table[\s\S]*?<\/table>/);
  if (!tableMatch) throw new Error("no <table> found on the page");
  const table = tableMatch[0];

  const rows = table.match(/<tr[\s\S]*?<\/tr>/g) ?? [];
  if (rows.length < 2)
    throw new Error(`table has only ${rows.length} row(s); expected header + data`);

  // Validate header against expected columns.
  const headerCells = (rows[0]!.match(/<th[^>]*>[\s\S]*?<\/th>/g) ?? []).map(stripTags);
  const expected = ["Track Name", "Composer", "Album", "Listen"];
  for (let i = 0; i < expected.length; i++) {
    if (headerCells[i]?.trim() !== expected[i]) {
      throw new Error(
        `unexpected header at col ${i}: got "${headerCells[i] ?? "<missing>"}", expected "${expected[i]}"`,
      );
    }
  }

  const out: Row[] = [];
  for (const row of rows.slice(1)) {
    const cells = row.match(/<td[^>]*>[\s\S]*?<\/td>/g) ?? [];
    if (cells.length < 4) continue; // skip malformed/empty rows
    const name = stripTags(cells[0]!).trim();
    const artist = stripTags(cells[1]!).trim();
    const album = stripTags(cells[2]!).trim();
    const hrefMatch = cells[3]!.match(/href="([^"]+)"/);
    const url = hrefMatch ? decodeEntities(hrefMatch[1]!) : null;
    if (!name || !artist || !album) continue;
    out.push({ name, artist, album, url });
  }
  return out;
}

// --- TOML emission ----------------------------------------------------------

interface EmittedFile {
  path: string;
  content: string;
}

/** Group rows by album and build one TOML file per group, sorted by name. */
function buildTomlFiles(rows: Row[]): EmittedFile[] {
  const byAlbum = new Map<string, Row[]>();
  for (const r of rows) {
    const list = byAlbum.get(r.album) ?? [];
    list.push(r);
    byAlbum.set(r.album, list);
  }

  const files: EmittedFile[] = [];
  for (const [album, group] of byAlbum) {
    group.sort((a, b) => a.name.localeCompare(b.name, "en", { sensitivity: "base" }));
    const blocks: string[] = [`# ${album}`, ""];
    for (const r of group) {
      const block: string[] = ["[[track]]"];
      block.push(`name = ${JSON.stringify(r.name)}`);
      block.push(`artist = ${JSON.stringify(r.artist)}`);
      block.push(`songPack = ${JSON.stringify(album)}`);
      if (r.url) block.push(`preview = ${JSON.stringify(r.url)}`);
      blocks.push(block.join("\n"), "");
    }
    const content = blocks.join("\n").trimEnd() + "\n";
    const stem =
      album
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "") || "misc";
    files.push({ path: join(DATA_DIR, `${stem}.toml`), content });
  }

  files.sort((a, b) => a.path.localeCompare(b.path));
  return files;
}

// --- diffing ----------------------------------------------------------------

async function loadExistingTrackFiles(): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (!existsSync(DATA_DIR)) return map;
  const entries = await readdir(DATA_DIR, { withFileTypes: true });
  for (const e of entries) {
    if (!e.isFile() || !e.name.endsWith(".toml") || e.name === "_policy.toml") continue;
    const path = join(DATA_DIR, e.name);
    map.set(path, await readFile(path, "utf-8"));
  }
  return map;
}

interface Plan {
  toWrite: EmittedFile[]; // new or changed
  toDelete: string[]; // existing files no longer produced
  unchanged: number;
}

function planChanges(emitted: EmittedFile[], existing: Map<string, string>): Plan {
  const toWrite: EmittedFile[] = [];
  const toDelete: string[] = [];
  let unchanged = 0;

  for (const f of emitted) {
    const cur = existing.get(f.path);
    if (cur === undefined || cur !== f.content) toWrite.push(f);
    else unchanged++;
  }

  const emittedPaths = new Set(emitted.map((f) => f.path));
  for (const path of existing.keys()) {
    if (!emittedPaths.has(path)) toDelete.push(path);
  }

  toDelete.sort();
  return { toWrite, toDelete, unchanged };
}

// --- main -------------------------------------------------------------------

async function main(): Promise<void> {
  const { yes, dryRun } = parseArgs(process.argv);

  console.log(`Fetching ${PAGE_URL} ...`);
  const res = await fetch(PAGE_URL, { redirect: "follow" });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText} fetching ${PAGE_URL}`);
  const html = await res.text();

  const rows = parseTable(html);
  const albumCount = new Set(rows.map((r) => r.album)).size;
  console.log(`Parsed ${rows.length} track(s) across ${albumCount} album(s).`);

  const emitted = buildTomlFiles(rows);
  const existing = await loadExistingTrackFiles();
  const plan = planChanges(emitted, existing);

  console.log(
    `\nPlan: ${plan.toWrite.length} to write/update, ${plan.toDelete.length} to delete, ${plan.unchanged} unchanged.`,
  );

  if (plan.toWrite.length === 0 && plan.toDelete.length === 0) {
    console.log("Nothing to do — data is already up to date.");
    return;
  }

  if (dryRun) {
    for (const f of plan.toWrite) {
      console.log(`\n--- would write ${f.path} ---\n${f.content}`);
    }
    for (const p of plan.toDelete) {
      console.log(`--- would delete ${p} ---`);
    }
    return;
  }

  // Summarize what's about to change before asking.
  for (const f of plan.toWrite) {
    const isNew = !existing.has(f.path);
    console.log(`  ${isNew ? "ADD" : "UPD"} ${f.path}`);
  }
  for (const p of plan.toDelete) {
    console.log(`  DEL ${p}`);
  }

  let apply = yes;
  if (!yes) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    try {
      const ans = (await rl.question("\nApply these changes? [y/N] ")).trim().toLowerCase();
      apply = ans === "y" || ans === "yes";
    } finally {
      rl.close();
    }
  }
  if (!apply) {
    console.log("Aborted — no files written.");
    return;
  }

  await mkdir(DATA_DIR, { recursive: true });
  for (const f of plan.toWrite) {
    await writeFile(f.path, f.content, "utf-8");
    console.log(`wrote ${f.path}`);
  }
  for (const p of plan.toDelete) {
    await rm(p);
    console.log(`deleted ${p}`);
  }
  console.log("\nDone.");
}

await main();
