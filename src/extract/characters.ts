import type { Query } from "../parser.js";
import type { Localizer } from "../localization.js";
import { resolveTitleName } from "./titleUtils.js";
import type { GameLookup } from "../gameLookup.js";
import { fullName } from "./names.js";
import { charName, characterAge, num } from "./common.js";
import { effectiveSkills, type EffectiveSkills, type SkillSet } from "./skills.js";

export interface CharacterInfo {
  id: number;
  name: string;
  age: number | null;
  female: boolean;
  /** Name of the ruler whose court this character is in, if any. */
  employer: string | null;
  /** Base skills plus trait bonuses (base only when no game files are available). */
  skills: SkillSet;
  /** Base, trait bonus and effective skills side by side. */
  skillDetail: EffectiveSkills;
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

export function extractCharacter(
  q: Query,
  loc: Localizer,
  id: number,
  lookup: GameLookup | null = null,
): CharacterInfo | null {
  const firstName = q.at(`/living/${id}/first_name`);
  if (firstName === undefined) return null;

  // Set trait lookup for this parse
  const traitsLookup = q.at("/traits_lookup") as string[] | null | undefined;
  loc.setTraitLookup(traitsLookup ?? null);

  // The save's `skill` array is base skill; effectiveSkills adds trait bonuses when the
  // game files are available (otherwise `skills` equals the base values).
  const skillDetail = effectiveSkills(q, loc, lookup, id);
  const skills = skillDetail.effective;

  // Traits
  const traitIndices = (q.at(`/living/${id}/traits`) as number[] | undefined) ?? [];
  const traits = traitIndices.map((idx) => loc.resolveTrait(idx));

  // Financial/status data
  const gold = (q.at(`/living/${id}/alive_data/gold/value`) as number | undefined) ?? null;
  // `currency` is the spendable amount (what the game shows); `accumulated` is lifetime.
  const prestige =
    num(q.at(`/living/${id}/alive_data/prestige/currency`)) ??
    num(q.at(`/living/${id}/alive_data/prestige/accumulated`));
  const piety =
    num(q.at(`/living/${id}/alive_data/piety/currency`)) ??
    num(q.at(`/living/${id}/alive_data/piety/accumulated`));
  const age = characterAge(q, id);
  const employerId = num(q.at(`/living/${id}/court_data/employer`));
  const employer = employerId !== null ? charName(q, employerId) : null;
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
    age,
    female: q.at(`/living/${id}/female`) === true,
    employer,
    skills,
    skillDetail,
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
  // Also drop diacritics, spaces and hyphens so "Gilla Patraic" finds "Gilla-Pátraic".
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
    // exec guarantees m[1] and m[2] are defined.
    // Match the stored key or the name the game shows.
    const shown = display(m[2]!);
    if (normalizeName(m[2]!).includes(needle) || normalizeName(shown).includes(needle))
      out.push({ id: Number(m[1]!), name: shown, primaryTitle: null });
  }
  return out;
}
