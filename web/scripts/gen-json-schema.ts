/**
 * Generate JSON Schema (Draft-07) files for the three TOML document shapes in
 * data/: rights-holder policy, track file, and artist.
 *
 * Source of truth is web/src/data/schema.ts (zod v4). We use zod's native
 * z.toJSONSchema() so the generated schemas can never drift from the zod
 * schemas the loader validates against.
 *
 * Extra fields present in data but not declared in zod (songPack, section,
 * duration, preview) are intentionally allowed: we override every
 * `additionalProperties: false` that zod emits by default to `true`, so the
 * editor (Even Better TOML / taplo) won't red-squiggle them while still
 * offering completion for the known fields.
 *
 * Output: schema/rights-holder-policy.json, schema/track-file.json,
 *         schema/artist.json
 *
 * Usage: pnpm tsx scripts/gen-json-schema.ts [output-dir]
 */
import { writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "zod";
import { artistSchema, rightsHolderPolicySchema, trackFileSchema } from "../src/data/schema.js";

const OUT_DIR = resolve(import.meta.dirname, "..", "..", process.argv[2] ?? "schema");

const TARGET = "draft-07" as const;

/** Recursively flip every `additionalProperties: false` to `true`. */
function allowAdditionalProperties(node: unknown): void {
  if (node === null || typeof node !== "object") return;
  const obj = node as Record<string, unknown>;
  if ("additionalProperties" in obj) obj.additionalProperties = true;
  for (const v of Object.values(obj)) allowAdditionalProperties(v);
}

const schemas = [
  {
    fileName: "rights-holder-policy.json",
    title: "Rights Holder Policy",
    description: "Top-level _policy.toml for a rights holder directory.",
    schema: rightsHolderPolicySchema,
  },
  {
    fileName: "track-file.json",
    title: "Track File",
    description:
      "A track-list TOML file (collection of [[track]]) under a rights holder directory.",
    schema: trackFileSchema,
  },
  {
    fileName: "artist.json",
    title: "Artist",
    description: "An artist entry TOML file under data/artists/.",
    schema: artistSchema,
  },
] as const;

async function main(): Promise<void> {
  await mkdir(OUT_DIR, { recursive: true });

  for (const { fileName, title, description, schema } of schemas) {
    const jsonSchema = z.toJSONSchema(schema, { target: TARGET }) as Record<string, unknown>;
    allowAdditionalProperties(jsonSchema);
    // Attach title/description + $schema for nicer hover/completion UX.
    jsonSchema.title = title;
    jsonSchema.description = description;
    jsonSchema.$schema = "https://json-schema.org/draft-07/schema";
    const path = resolve(OUT_DIR, fileName);
    const content = JSON.stringify(jsonSchema, null, 2) + "\n";
    await writeFile(path, content, "utf-8");
    console.log(`wrote ${path}`);
  }
}

await main();
