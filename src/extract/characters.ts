import type { Query } from "../parser.js";
import { fullName } from "./names.js";
import type { Localizer } from "../localization.js";
import { resolveTitleName } from "./titleUtils.js";
import { effectiveSkills } from "./skills.js";

export interface CharacterInfo {
  id: number;
  name: string;
  skills: {
    diplomacy: number;
    martial: number;
    stewardship: number;
    intrigue: number;
    learning: number;
    prowess: number;
  };
  traits: string[];
  gold: number | null;
  prestige: number | null;
  piety: number | null;
  health: number | null;
  stress: number | null;
  primaryTitle: string | null;
  claims: { title: string; pressed: boolean }[];
}

export interface CharacterMatch {
  id: number;
  name: string;
  primaryTitle: string | null;
}

export function extractCharacter(q: Query, loc: Localizer, id: number): CharacterInfo | null {
  const firstName = q.at(`/living/${id}/first_name`);
  if (firstName === undefined) return null;

  // Set trait lookup for this parse
  const traitsLookup = q.at("/traits_lookup") as string[] | null | undefined;
  loc.setTraitLookup(traitsLookup ?? null);

  // Skills: save stores base values (diplomacy, martial, stewardship, intrigue, learning,
  // prowess); add trait modifiers so the numbers match the in-game character sheet.
  const skillArr = (q.at(`/living/${id}/skill`) as number[] | undefined) ?? [];
  const traitIndices = (q.at(`/living/${id}/traits`) as number[] | undefined) ?? [];
  const xp = (q.at(`/living/${id}/trait_xp_amounts`) as number[] | undefined) ?? [];
  const skills = effectiveSkills(loc, skillArr, traitIndices, xp).total;
  const traits = traitIndices.map((idx) => loc.resolveTrait(idx));

  // Financial/status data
  const gold = (q.at(`/living/${id}/alive_data/gold/value`) as number | undefined) ?? null;
  const prestige =
    (q.at(`/living/${id}/alive_data/prestige/accumulated`) as number | undefined) ?? null;
  const piety = (q.at(`/living/${id}/alive_data/piety/accumulated`) as number | undefined) ?? null;
  const health = (q.at(`/living/${id}/alive_data/health`) as number | undefined) ?? null;
  const stress = (q.at(`/living/${id}/alive_data/stress`) as number | undefined) ?? null;

  // Primary title from domain[0]
  const domain = (q.at(`/living/${id}/landed_data/domain`) as number[] | undefined) ?? [];
  const primaryTitleId = domain[0];
  const primaryTitle =
    primaryTitleId !== undefined ? resolveTitleName(q, loc, primaryTitleId) : null;

  // Claims
  const rawClaims =
    (q.at(`/living/${id}/alive_data/claim`) as
      | Array<{ title: number; pressed?: boolean }>
      | undefined) ?? [];
  const claims = rawClaims.map((c) => ({
    title: resolveTitleName(q, loc, c.title),
    pressed: c.pressed === true,
  }));

  return {
    id,
    name: fullName(q, loc, id),
    skills,
    traits,
    gold,
    prestige,
    piety,
    health,
    stress,
    primaryTitle,
    claims,
  };
}

// CK3 stores custom names in an encoded form (e.g. "CrI_chA_n" for "Críchán"):
// underscores separate combining segments and casing marks accents. Strip
// underscores and lowercase so a plain query ("crichan") matches. This only
// removes separators, so it never matches less than a bare lowercase compare.
function normalizeName(s: string): string {
  // Also drop diacritics so "Patraic" finds "Pátraic".
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[_\s-]/g, "");
}

export function findCharacters(
  text: string,
  name: string,
  display: (raw: string) => string = (s) => s,
): CharacterMatch[] {
  const start = text.indexOf("\nliving={");
  if (start === -1) return [];
  // end = next top-level key after living's opening
  const endRe = /\n[a-z_][a-z0-9_]*=\{/g;
  endRe.lastIndex = start + "\nliving={".length;
  const endM = endRe.exec(text);
  const end = endM ? endM.index : text.length;
  const needle = normalizeName(name);
  const re = /(?:^|\n)(\d+)=\{\s*first_name="([^"]*)"/g;
  re.lastIndex = start;
  const out: CharacterMatch[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null && m.index < end) {
    // Both capture groups are non-optional in the regex, so a successful
    // exec guarantees m[1] and m[2] are defined. Match the stored key or the name the game shows.
    const shown = display(m[2]!);
    if (normalizeName(m[2]!).includes(needle) || normalizeName(shown).includes(needle))
      out.push({ id: Number(m[1]!), name: shown, primaryTitle: null });
  }
  return out;
}
