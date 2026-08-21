import { readFile } from "node:fs/promises";
import { contentPolicySchema } from "../src/data/schema.js";

const filePath = process.argv[2];
if (!filePath) {
  console.error("Usage: tsx scripts/validate-json.ts <content-policy.json>");
  process.exit(1);
}

const raw = await readFile(filePath, "utf-8");

let json: unknown;
try {
  json = JSON.parse(raw);
} catch (e) {
  console.error(`Invalid JSON: ${String(e)}`);
  process.exit(1);
}

const result = contentPolicySchema.safeParse(json);
if (!result.success) {
  console.error(`${result.error.issues.length} issue(s):`);
  for (const issue of result.error.issues) {
    console.error(`  ${issue.path.join(".")}: ${issue.message}`);
  }
  process.exit(1);
}

const { rightsHolders, artists, independentTracks } = result.data;
const trackCount =
  Object.values(rightsHolders).reduce((n, r) => n + r.tracks.length, 0) + independentTracks.length;
console.log(
  `OK: ${Object.keys(rightsHolders).length} rights holder(s), ${Object.keys(artists).length} artist(s), ${trackCount} track(s)`,
);
