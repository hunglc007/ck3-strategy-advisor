import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseBlock, tokenize, type Node } from "./scriptTree.js";

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

/** Province id -> [x, z] world position, parsed from `building_locators.txt` text. */
export function parseProvincePositions(text: string): Map<number, [number, number]> {
  const out = new Map<number, [number, number]>();
  for (const m of text.matchAll(/id=(\d+)\s*position=\{\s*([-\d.]+)\s+[-\d.]+\s+([-\d.]+)/g)) {
    const id = Number(m[1]);
    if (!out.has(id)) out.set(id, [Number(m[2]), Number(m[3])]);
  }
  return out;
}

export function loadProvincePositions(gameDir: string | null): Map<number, [number, number]> {
  if (!gameDir) return new Map();
  try {
    return parseProvincePositions(
      readFileSync(join(gameDir, "gfx", "map", "map_object_data", "building_locators.txt"), "utf8"),
    );
  } catch {
    return new Map();
  }
}

/** Straight-line distance between two provinces in map units, or null if either is unknown. */
export function provinceDistance(
  positions: Map<number, [number, number]>,
  a: number,
  b: number,
): number | null {
  const pa = positions.get(a);
  const pb = positions.get(b);
  return pa && pb ? Math.hypot(pa[0] - pb[0], pa[1] - pb[1]) : null;
}
