import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { resolveGameRoot } from "./gameData.js";

export class Localizer {
  private map = new Map<string, string>();
  private traitLookup: string[] | null = null;
  private warned = false;

  constructor(gameDir: string | null) {
    const root = resolveGameRoot(gameDir);
    if (root) this.loadDir(join(root, "localization", "english"));
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
