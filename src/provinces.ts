import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseBlock, tokenize, type Node } from "./traitSkills.js";

export interface ProvinceRegion {
  county: string | null;
  duchy: string | null;
  kingdom: string | null;
  empire: string | null;
}

const TIER_FIELD: Record<string, keyof ProvinceRegion> = {
  e: "empire",
  k: "kingdom",
  d: "duchy",
  c: "county",
};

function walk(
  node: Node,
  ancestors: Partial<ProvinceRegion>,
  out: Map<number, ProvinceRegion>,
): void {
  for (const [key, value] of node) {
    if (typeof value === "string") continue;
    const field = key.length > 1 && key[1] === "_" ? TIER_FIELD[key[0]!] : undefined;
    if (key.startsWith("b_")) {
      const prov = value.find(([k, v]) => k === "province" && typeof v === "string");
      const id = prov ? Number(prov[1]) : NaN;
      if (Number.isFinite(id))
        out.set(id, {
          county: ancestors.county ?? null,
          duchy: ancestors.duchy ?? null,
          kingdom: ancestors.kingdom ?? null,
          empire: ancestors.empire ?? null,
        });
      continue;
    }
    walk(value, field ? { ...ancestors, [field]: key } : ancestors, out);
  }
}

/**
 * Province id -> the county/duchy/kingdom/empire it belongs to by default (de jure),
 * read from the game's `common/landed_titles` files. The save stores each character's
 * location as a province id but not where that is, so this is the only way to tell
 * who is in the British Isles and who is in Hungary.
 */
export function parseProvinceRegions(text: string): Map<number, ProvinceRegion> {
  const out = new Map<number, ProvinceRegion>();
  walk(parseBlock(tokenize(text), { i: 0 }), {}, out);
  return out;
}

export function loadProvinceRegions(gameDir: string | null): Map<number, ProvinceRegion> {
  const out = new Map<number, ProvinceRegion>();
  if (!gameDir) return out;
  const dir = join(gameDir, "common", "landed_titles");
  let files: string[];
  try {
    files = readdirSync(dir).filter((f) => f.endsWith(".txt"));
  } catch {
    return out;
  }
  for (const f of files) {
    try {
      for (const [k, v] of parseProvinceRegions(readFileSync(join(dir, f), "utf8"))) out.set(k, v);
    } catch {
      /* skip unreadable file */
    }
  }
  return out;
}
