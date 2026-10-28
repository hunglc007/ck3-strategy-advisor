import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { resolveGameRoot } from "./gameData.js";
import { loadCouncilTaskRoles, type CouncilRole } from "./councilTasks.js";
import {
  loadProvincePositions,
  loadProvinceRegions,
  provinceDistance,
  type ProvinceRegion,
} from "./provinces.js";

export class Localizer {
  private map = new Map<string, string>();
  /** Keys from the localization "names" folders: character names the save stores escaped. */
  private nameKeys = new Set<string>();
  private traitLookup: string[] | null = null;
  private warned = false;
  private readonly gameRoot: string | null;
  private provinces: Map<number, ProvinceRegion> | null = null;
  private positions: Map<number, [number, number]> | null = null;
  private taskRoles: Map<string, CouncilRole> | null = null;

  constructor(gameDir: string | null, modLocalizationDirs: string[] = []) {
    const root = resolveGameRoot(gameDir);
    this.gameRoot = root;
    if (root) this.loadDir(join(root, "localization", "english"));
    // Enabled mods load after the base game, so their strings override it (as in the game).
    for (const dir of modLocalizationDirs) this.loadDir(dir);
  }

  /**
   * Localized text for a key exactly as stored, or the key itself when there is no entry.
   * Unlike `text` this keeps spaces and markup, which name parts such as "de " rely on.
   */
  rawText(raw: unknown): string {
    const key = typeof raw === "string" ? raw : String(raw ?? "");
    return this.map.get(key) ?? key;
  }

  /** Display name for a stored first_name key (e.g. RO_gnvaldr -> Rögnvaldr). */
  charName(raw: unknown): string {
    return this.rawText(raw);
  }

  /** De jure county/duchy/kingdom/empire of a province id; parsed from the game files on first use. */
  provinceRegion(id: number): ProvinceRegion | undefined {
    this.provinces ??= loadProvinceRegions(this.gameRoot);
    return this.provinces.get(id);
  }

  /** Map distance between two provinces (null when unknown or no game files). */
  distance(a: number, b: number): number | null {
    this.positions ??= loadProvincePositions(this.gameRoot);
    return provinceDistance(this.positions, a, b);
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
    const isNamesFile = path.split(/[\\/]/).includes("names");
    for (const line of text.split("\n")) {
      const m = /^\s+([\w.-]+):\d*\s+"(.*)"/.exec(line);
      // m matched -> both non-optional capture groups are present
      if (m) {
        this.map.set(m[1]!, m[2]!);
        if (isNamesFile) this.nameKeys.add(m[1]!);
      }
    }
  }

  /**
   * The save stores names with an accent as an escaped key ("BeorhtflE_d" for "Beorhtflæd",
   * "RO_gnvaldr" for "Rögnvaldr", "PAAl" for "Pål"); the game's name localization maps them back. Replaces every
   * such token in `text` and leaves everything else (including other loc keys) untouched.
   */
  decodeNames(text: string): string {
    if (this.nameKeys.size === 0) return text;
    return text.replace(/[A-Za-z0-9_-]+/g, (tok) =>
      this.nameKeys.has(tok) ? this.map.get(tok)! : tok,
    );
  }

  /** Per-save trait index table (from the gamestate's traits_lookup). */
  setTraitLookup(lookup: string[] | null): void {
    this.traitLookup = lookup;
  }

  has(key: string): boolean {
    return this.map.has(key);
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

  /**
   * Like `resolve`, but strips CK3 text markup so the value reads as plain text:
   * `[married|E]` -> "married", `$OTHER_KEY$` -> its value (or dropped),
   * `#P text#!` colour codes -> "text", `@icon!` inline icons and other
   * `[script]` expressions dropped.
   */
  text(key: string): string {
    const v = this.map.get(key);
    if (v === undefined) return this.resolve(key);
    return (
      v
        .replace(/\$([\w.]+)\$/g, (_, k: string) => this.map.get(k) ?? "")
        .replace(/@[\w.]+!/g, "")
        // [concept|E] -> concept; [ROOT.Char.GetName|E] and other script calls -> dropped
        .replace(/\[([^\]|]+)\|[A-Za-z]+\]/g, (_, inner: string) =>
          /^[\w ]+$/.test(inner) ? inner : "",
        )
        .replace(/\[[^\]]*\]/g, "")
        .replace(/#[A-Za-z_]+ /g, "")
        .replace(/#!/g, "")
        .replace(/\\n/g, " ")
        .replace(/\s{2,}/g, " ")
        .trim()
    );
  }

  /** Which councillor a council task type belongs to, read from the game files (null if unknown). */
  councilTaskRole(type: string): CouncilRole | null {
    this.taskRoles ??= loadCouncilTaskRoles(this.gameRoot);
    return this.taskRoles.get(type) ?? null;
  }

  /** Alias of traitIdentifier. */
  traitKey(idx: number): string | null {
    return this.traitIdentifier(idx);
  }

  /** The game's identifier for a trait index (e.g. "eccentric"), or null if unknown. */
  traitIdentifier(idx: number): string | null {
    return this.traitLookup?.[idx] ?? null;
  }

  resolveTrait(idx: number): string {
    const ident = this.traitLookup?.[idx];
    if (!ident) return `trait_${idx}`;
    // Game loc keys traits as "trait_<id>"; older fixtures key them bare.
    const prefixed = `trait_${ident}`;
    return this.map.has(prefixed) ? this.resolve(prefixed) : this.resolve(ident);
  }
}
