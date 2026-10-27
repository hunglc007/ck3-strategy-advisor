import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { loadTraitSkills, type TraitSkillData } from "./traitSkills.js";
import { loadProvinceRegions, type ProvinceRegion } from "./provinces.js";

export class Localizer {
  private map = new Map<string, string>();
  private traitLookup: string[] | null = null;
  private warned = false;
  private traitSkills = new Map<string, TraitSkillData>();
  private provinces: Map<number, ProvinceRegion> | null = null;

  constructor(private gameDir: string | null) {
    if (gameDir) {
      this.loadDir(join(gameDir, "localization", "english"));
      this.traitSkills = loadTraitSkills(gameDir);
    }
  }

  /** Raw trait key (e.g. "lifestyle_reveler") for a per-save trait index. */
  traitKey(idx: number): string | null {
    return this.traitLookup?.[idx] ?? null;
  }

  /** Skill modifiers a trait grants, from the game's common/traits files. */
  traitSkillData(key: string): TraitSkillData | undefined {
    return this.traitSkills.get(key);
  }

  /** De jure county/duchy/kingdom/empire of a province id; parsed from the game files on first use. */
  provinceRegion(id: number): ProvinceRegion | undefined {
    this.provinces ??= loadProvinceRegions(this.gameDir);
    return this.provinces.get(id);
  }

  private loadDir(dir: string): void {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    } // missing dir -> empty map
    for (const name of entries) {
      const path = join(dir, name);
      let st;
      try {
        st = statSync(path);
      } catch {
        continue;
      }
      if (st.isDirectory()) {
        this.loadDir(path);
        continue;
      } // CK3 nests subfolders
      if (!name.endsWith(".yml")) continue;
      this.loadFile(path);
    }
  }

  private loadFile(path: string): void {
    const text = readFileSync(path, "utf8");
    for (const line of text.split("\n")) {
      const m = /^\s+([\w.-]+):\d*\s+"(.*)"/.exec(line);
      // m matched -> both non-optional capture groups are present
      if (m) this.map.set(m[1]!, m[2]!);
    }
  }

  /** Per-save trait index table (from the gamestate's traits_lookup). */
  setTraitLookup(lookup: string[] | null): void {
    this.traitLookup = lookup;
  }

  resolve(key: string): string {
    const v = this.map.get(key);
    if (v !== undefined) return v;
    if (!this.warned && this.map.size === 0) {
      this.warned = true;
      process.stderr.write(
        "ck3-advisor: no localization loaded (game dir missing?); showing raw keys.\n",
      );
    }
    return key; // fallback
  }

  resolveTrait(idx: number): string {
    const ident = this.traitLookup?.[idx];
    return ident ? this.resolve(ident) : `trait_${idx}`;
  }
}
