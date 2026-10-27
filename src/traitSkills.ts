import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export const SKILL_KEYS = [
  "diplomacy",
  "martial",
  "stewardship",
  "intrigue",
  "learning",
  "prowess",
] as const;
export type SkillName = (typeof SKILL_KEYS)[number];
export type SkillBonus = Partial<Record<SkillName, number>>;

export interface TraitSkillData {
  /** Flat skill modifiers every holder of the trait gets. */
  base: SkillBonus;
  /** One entry per XP track; each threshold adds its skill modifiers once reached. */
  tracks: { xp: number; bonus: SkillBonus }[][];
}

export type Node = Array<[string, string | Node]>;

export function tokenize(text: string): string[] {
  const out: string[] = [];
  for (const rawLine of text.split("\n")) {
    const line = rawLine.replace(/#.*$/, "");
    // Quoted strings are kept whole; operators other than "=" are irrelevant here.
    for (const m of line.matchAll(/"[^"]*"|[{}=]|[^\s{}=]+/g)) out.push(m[0]);
  }
  return out;
}

export function parseBlock(tokens: string[], pos: { i: number }): Node {
  const node: Node = [];
  while (pos.i < tokens.length) {
    const tok = tokens[pos.i++]!;
    if (tok === "}") return node;
    if (tok === "{") {
      // Anonymous block, e.g. the list after `rgb` in `color = rgb { 1 2 3 }`: skip it whole
      // so its closing brace is not mistaken for the end of the enclosing block.
      parseBlock(tokens, pos);
      continue;
    }
    if (tokens[pos.i] === "=") {
      pos.i++;
      if (tokens[pos.i] === "{") {
        pos.i++;
        node.push([tok, parseBlock(tokens, pos)]);
      } else {
        node.push([tok, tokens[pos.i++] ?? ""]);
      }
    }
  }
  return node;
}

function skillsOf(node: Node): SkillBonus {
  const out: SkillBonus = {};
  for (const [k, v] of node) {
    if (typeof v !== "string" || !(SKILL_KEYS as readonly string[]).includes(k)) continue;
    const n = Number(v);
    if (Number.isFinite(n)) out[k as SkillName] = (out[k as SkillName] ?? 0) + n;
  }
  return out;
}

function trackOf(node: Node): { xp: number; bonus: SkillBonus }[] {
  const levels: { xp: number; bonus: SkillBonus }[] = [];
  for (const [k, v] of node) {
    if (typeof v === "string" || !/^\d+$/.test(k)) continue;
    levels.push({ xp: Number(k), bonus: skillsOf(v) });
  }
  return levels.sort((a, b) => a.xp - b.xp);
}

/** Parse `common/traits/*.txt` text into per-trait skill modifiers. */
export function parseTraitSkills(text: string): Map<string, TraitSkillData> {
  const root = parseBlock(tokenize(text), { i: 0 });
  const out = new Map<string, TraitSkillData>();
  for (const [name, body] of root) {
    if (typeof body === "string") continue;
    const tracks: TraitSkillData["tracks"] = [];
    for (const [k, v] of body) {
      if (typeof v === "string") continue;
      if (k === "track") tracks.push(trackOf(v));
      else if (k === "tracks") {
        for (const [, t] of v) if (typeof t !== "string") tracks.push(trackOf(t));
      }
    }
    out.set(name, { base: skillsOf(body), tracks });
  }
  return out;
}

export function loadTraitSkills(gameDir: string | null): Map<string, TraitSkillData> {
  const out = new Map<string, TraitSkillData>();
  if (!gameDir) return out;
  const dir = join(gameDir, "common", "traits");
  let files: string[];
  try {
    files = readdirSync(dir).filter((f) => f.endsWith(".txt"));
  } catch {
    return out;
  }
  for (const f of files) {
    try {
      for (const [k, v] of parseTraitSkills(readFileSync(join(dir, f), "utf8"))) out.set(k, v);
    } catch {
      /* skip unreadable file */
    }
  }
  return out;
}
