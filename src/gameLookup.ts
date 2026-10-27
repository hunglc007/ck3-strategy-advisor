import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import type { Localizer } from "./localization.js";

export interface Category {
  /** Folders relative to the game root, scanned recursively for `.txt` scripts. */
  dirs: string[];
  /** Localization key patterns tried in order; `{k}` is the entry key. */
  name: string[];
  desc: string[];
  about: string;
  /** Also index top-level `key = value` scalars (script values), not just blocks. */
  scalars?: boolean;
}

// What each category covers. Localization patterns are listed most-specific
// first because generic keys (e.g. a bare "brave") also exist in unrelated files.
export const CATEGORIES: Record<string, Category> = {
  men_at_arms: {
    dirs: ["common/men_at_arms_types"],
    name: ["{k}"],
    desc: ["{k}_flavor", "{k}_desc"],
    about: "men-at-arms regiment types (damage, toughness, counters, cost)",
  },
  casus_belli: {
    dirs: ["common/casus_belli_types"],
    name: ["{k}"],
    desc: ["{k}_desc", "{k}_tooltip"],
    about: "casus belli (war goals, conditions, costs)",
  },
  building: {
    dirs: ["common/buildings"],
    name: ["building_{k}"],
    desc: ["building_{k}_desc"],
    about: "holding buildings (cost, effects, requirements)",
  },
  trait: {
    dirs: ["common/traits"],
    name: ["trait_{k}"],
    desc: ["trait_{k}_desc", "trait_{k}_character_desc"],
    about: "character traits (skills, opinions, flags)",
  },
  decision: {
    dirs: ["common/decisions"],
    name: ["{k}", "{k}_title"],
    desc: ["{k}_desc", "{k}_tooltip"],
    about: "decisions (conditions, costs, effects)",
  },
  tradition: {
    dirs: ["common/culture/traditions"],
    name: ["{k}_name", "{k}"],
    desc: ["{k}_desc"],
    about: "cultural traditions",
  },
  innovation: {
    dirs: ["common/culture/innovations"],
    name: ["{k}"],
    desc: ["{k}_desc"],
    about: "cultural innovations",
  },
  pillar: {
    dirs: ["common/culture/pillars"],
    name: ["{k}_name", "{k}"],
    desc: ["{k}_desc"],
    about: "cultural pillars (ethos, heritage, language, martial custom)",
  },
  culture: {
    dirs: ["common/culture/cultures"],
    name: ["{k}", "{k}_name"],
    desc: ["{k}_desc"],
    about: "cultures (traditions, pillars, name lists)",
  },
  law: {
    dirs: ["common/laws"],
    name: ["{k}"],
    desc: ["{k}_desc", "{k}_effects"],
    about: "realm, succession and title laws",
  },
  government: {
    dirs: ["common/governments"],
    name: ["{k}"],
    desc: ["{k}_desc"],
    about: "government types",
  },
  council_task: {
    dirs: ["common/council_tasks"],
    name: ["{k}"],
    desc: ["{k}_desc"],
    about: "council tasks",
  },
  court_position: {
    dirs: ["common/court_positions/types"],
    name: ["{k}"],
    desc: ["{k}_desc"],
    about: "court positions (physician, chaplain, ...)",
  },
  perk: {
    dirs: ["common/lifestyle_perks"],
    name: ["{k}_name", "{k}"],
    desc: ["{k}_desc"],
    about: "lifestyle perks",
  },
  focus: {
    dirs: ["common/focuses"],
    name: ["{k}"],
    desc: ["{k}_desc"],
    about: "lifestyle focuses",
  },
  interaction: {
    dirs: ["common/character_interactions"],
    name: ["{k}"],
    desc: ["{k}_desc"],
    about: "character interactions (diplomacy, schemes, requests)",
  },
  doctrine: {
    dirs: ["common/religion/doctrine_types"],
    name: ["{k}_name", "{k}"],
    desc: ["{k}_desc"],
    about: "faith doctrines",
  },
  tenet: {
    dirs: ["common/religion/tenet_types"],
    name: ["{k}_name", "{k}"],
    desc: ["{k}_desc"],
    about: "faith tenets",
  },
  faith: {
    dirs: ["common/religion/religion_types"],
    name: ["{k}", "{k}_name"],
    desc: ["{k}_adj", "{k}_desc"],
    about: "religions and their faiths",
  },
  dynasty_legacy: {
    dirs: ["common/dynasty_legacies"],
    name: ["{k}_name", "{k}"],
    desc: ["{k}_desc"],
    about: "dynasty legacies and perks",
  },
  faction: {
    dirs: ["common/factions"],
    name: ["{k}"],
    desc: ["{k}_desc"],
    about: "faction types",
  },
  secret: {
    dirs: ["common/secret_types"],
    name: ["{k}"],
    desc: ["{k}_desc"],
    about: "secret types",
  },
  artifact: {
    dirs: ["common/artifacts/types"],
    name: ["{k}"],
    desc: ["{k}_desc"],
    about: "artifact types",
  },
  holding: {
    dirs: ["common/holdings"],
    name: ["{k}"],
    desc: ["{k}_desc"],
    about: "holding types",
  },
  activity: {
    dirs: ["common/activities/activity_types"],
    name: ["{k}"],
    desc: ["{k}_desc"],
    about: "activity types (feast, hunt, tournament, pilgrimage...)",
  },
  script_value: {
    dirs: ["common/script_values"],
    name: ["{k}"],
    desc: [],
    about: "named numbers/formulas the other scripts refer to (e.g. recruitment costs)",
    scalars: true,
  },
  scripted_effect: {
    dirs: ["common/scripted_effects"],
    name: ["{k}"],
    desc: [],
    about: "reusable effect snippets referenced by decisions and events",
  },
  scripted_trigger: {
    dirs: ["common/scripted_triggers"],
    name: ["{k}"],
    desc: [],
    about: "reusable condition snippets referenced by many scripts",
  },
  event: {
    dirs: ["events"],
    name: ["{k}.t"],
    desc: ["{k}.desc"],
    about: "events by id (e.g. `activity_feast.0001`); large, searched only when asked for",
  },
};

export interface Entry {
  category: string;
  key: string;
  /** Path relative to the game root, with forward slashes. */
  file: string;
  line: number;
  /** Script text of the block, `@constants` already substituted. */
  text: string;
  /** How many other files defined the same key (the last one wins in game). */
  overrides: number;
}

interface RawBlock {
  key: string;
  start: number;
  end: number;
}

const IDENT = /[A-Za-z0-9_.:@-]+/y;

/**
 * Find the `key = { ... }` blocks at depth 0 of a Paradox script file, plus the
 * file's `@name = value` constants. Comments and quoted strings are skipped when
 * matching braces. Scalars at depth 0 (`namespace = foo`) are ignored.
 */
export function parseTopLevel(
  text: string,
  opts: { scalars?: boolean } = {},
): {
  blocks: RawBlock[];
  vars: Map<string, string>;
} {
  const blocks: RawBlock[] = [];
  const vars = new Map<string, string>();
  const n = text.length;
  let i = text.charCodeAt(0) === 0xfeff ? 1 : 0;

  const skipTrivia = () => {
    while (i < n) {
      const c = text.charCodeAt(i);
      if (c === 35 /* # */) {
        while (i < n && text.charCodeAt(i) !== 10) i++;
      } else if (c === 32 || c === 9 || c === 10 || c === 13) i++;
      else break;
    }
  };

  // i points at '{'; returns the index just past the matching '}'.
  const skipBlock = (): number => {
    let depth = 0;
    while (i < n) {
      const c = text.charCodeAt(i);
      if (c === 35) {
        while (i < n && text.charCodeAt(i) !== 10) i++;
        continue;
      }
      if (c === 34 /* " */) {
        i++;
        while (i < n && text.charCodeAt(i) !== 34 && text.charCodeAt(i) !== 10) i++;
        i++;
        continue;
      }
      if (c === 123) depth++;
      else if (c === 125 && --depth === 0) return ++i;
      i++;
    }
    return n;
  };

  while (i < n) {
    skipTrivia();
    if (i >= n) break;
    IDENT.lastIndex = i;
    const m = IDENT.exec(text);
    if (!m) {
      i++;
      continue;
    }
    const key = m[0];
    const start = i;
    i += key.length;
    skipTrivia();
    if (text[i] !== "=") continue;
    i++;
    skipTrivia();
    if (text[i] === "{") {
      const end = skipBlock();
      blocks.push({ key, start, end });
    } else {
      const vs = i;
      if (text[i] === "@" && text[i + 1] === "[") {
        // `@[ a * b ]` formulas may contain spaces; they run to the closing bracket
        while (i < n && text[i] !== "]") i++;
        i++;
      } else {
        while (i < n && !/\s/.test(text[i]!)) i++;
      }
      if (key.startsWith("@")) vars.set(key, text.slice(vs, i));
      else if (opts.scalars) blocks.push({ key, start, end: i });
    }
  }
  return { blocks, vars };
}

// `@name` constants are file-local. Inside `@[ ... ]` formulas the names appear
// without the `@`; when every name resolves to a number the formula is evaluated
// and shown as `128 /* @[a * 1.28] */`, otherwise it is left as written.
function substituteVars(block: string, vars: Map<string, string>): string {
  if (!block.includes("@")) return block;
  const withFormulas = block.replace(/@\[([^\]]*)\]/g, (whole, expr: string) => {
    const filled = expr.replace(/[A-Za-z_]\w*/g, (id) => vars.get(`@${id}`) ?? id);
    if (!/^[\d.\s+\-*/()]+$/.test(filled)) return whole;
    try {
      const value = Function(`"use strict"; return (${filled});`)() as unknown;
      if (typeof value === "number" && Number.isFinite(value))
        return `${Math.round(value * 10000) / 10000} /* ${whole} */`;
    } catch {
      // fall through: leave the formula as written
    }
    return whole;
  });
  return withFormulas.replace(/@[A-Za-z_]\w*/g, (v) => vars.get(v) ?? v);
}

function listScripts(dir: string, out: string[] = []): string[] {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return out;
  }
  names.sort();
  for (const name of names) {
    const path = join(dir, name);
    let st;
    try {
      st = statSync(path);
    } catch {
      continue;
    }
    if (st.isDirectory()) listScripts(path, out);
    else if (name.endsWith(".txt")) out.push(path);
  }
  return out;
}

export interface SearchHit {
  entry: Entry;
  name: string;
  score: number;
}

export class GameLookup {
  private index = new Map<string, Map<string, Entry>>();

  constructor(
    private root: string | null,
    private loc: Localizer,
  ) {}

  get available(): boolean {
    return this.root !== null && existsSync(join(this.root, "common"));
  }

  categories(): string[] {
    return Object.keys(CATEGORIES);
  }

  private load(category: string): Map<string, Entry> {
    const cached = this.index.get(category);
    if (cached) return cached;
    const map = new Map<string, Entry>();
    const def = CATEGORIES[category];
    if (def && this.root) {
      const lineStarts = new Map<string, number[]>();
      for (const dir of def.dirs) {
        for (const path of listScripts(join(this.root, dir))) {
          const text = readFileSync(path, "utf8");
          const { blocks, vars } = parseTopLevel(text, { scalars: def.scalars });
          const file = relative(this.root, path).replace(/\\/g, "/");
          let starts = lineStarts.get(file);
          if (!starts) {
            starts = [0];
            for (let p = text.indexOf("\n"); p !== -1; p = text.indexOf("\n", p + 1))
              starts.push(p + 1);
            lineStarts.set(file, starts);
          }
          for (const b of blocks) {
            if (b.key.startsWith("@")) continue;
            // line number = 1 + number of line starts at or before the block
            let lo = 0;
            let hi = starts.length - 1;
            while (lo < hi) {
              const mid = (lo + hi + 1) >> 1;
              if (starts[mid]! <= b.start) lo = mid;
              else hi = mid - 1;
            }
            const prev = map.get(b.key);
            map.set(b.key, {
              category,
              key: b.key,
              file,
              line: lo + 1,
              text: substituteVars(text.slice(b.start, b.end), vars),
              overrides: prev ? prev.overrides + 1 : 0,
            });
          }
          lineStarts.delete(file);
        }
      }
    }
    this.index.set(category, map);
    return map;
  }

  private firstLoc(patterns: string[], key: string): string | null {
    for (const p of patterns) {
      const k = p.replace("{k}", key);
      if (this.loc.has(k)) return this.loc.text(k);
    }
    return null;
  }

  displayName(e: Entry): string {
    return this.firstLoc(CATEGORIES[e.category]!.name, e.key) ?? e.key;
  }

  description(e: Entry): string | null {
    return this.firstLoc(CATEGORIES[e.category]!.desc, e.key);
  }

  get(category: string, key: string): Entry | null {
    const map = this.load(category);
    const exact = map.get(key);
    if (exact) return exact;
    const lower = key.toLowerCase();
    for (const [k, e] of map) if (k.toLowerCase() === lower) return e;
    return null;
  }

  /** Entries whose key is a near match, for "did you mean" on a miss. */
  suggest(category: string, key: string, limit = 5): string[] {
    const lower = key.toLowerCase();
    const out: string[] = [];
    for (const k of this.load(category).keys()) {
      if (k.toLowerCase().includes(lower)) {
        out.push(k);
        if (out.length >= limit) break;
      }
    }
    return out;
  }

  search(query: string, category: string | undefined, limit: number): SearchHit[] {
    const tokens = query
      .toLowerCase()
      .split(/[\s_]+/)
      .filter((t) => t.length > 0);
    if (tokens.length === 0) return [];
    // `event` is large (tens of MB of scripts); only search it when asked for.
    const cats = category ? [category] : Object.keys(CATEGORIES).filter((c) => c !== "event");
    const q = query.toLowerCase().trim();
    const hits: SearchHit[] = [];
    for (const cat of cats) {
      for (const entry of this.load(cat).values()) {
        const key = entry.key.toLowerCase();
        const name = this.displayName(entry);
        const nameLower = name.toLowerCase();
        const haystack = `${key.replace(/_/g, " ")} ${nameLower}`;
        let score = 0;
        if (key === q || key === q.replace(/\s+/g, "_")) score = 100;
        else if (nameLower === q) score = 95;
        else if (tokens.every((t) => haystack.includes(t))) {
          score = 50;
          if (key.startsWith(q.replace(/\s+/g, "_"))) score += 20;
          if (nameLower.startsWith(q)) score += 15;
          if (nameLower.includes(q)) score += 10;
          score -= Math.min(key.length / 10, 5); // prefer shorter, more specific keys
        } else {
          const desc = this.description(entry)?.toLowerCase();
          if (desc && tokens.every((t) => desc.includes(t))) score = 20;
        }
        if (score > 0) hits.push({ entry, name, score });
      }
    }
    hits.sort((a, b) => b.score - a.score || a.entry.key.localeCompare(b.entry.key));
    return hits.slice(0, limit);
  }
}
