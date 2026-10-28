import type { Query } from "../parser.js";
import type { Localizer } from "../localization.js";
import { SKILLS, type GameLookup, type Skill } from "../gameLookup.js";
import { idList } from "./common.js";

export type SkillSet = Record<Skill, number>;

export interface EffectiveSkills {
  /** The `skill` array in the save: base skill, before any trait modifiers. */
  base: SkillSet;
  /** What the traits add (negative for penalties). */
  bonus: SkillSet;
  /** base + trait bonuses; the in-game number minus perks, artifacts and temporary modifiers. */
  effective: SkillSet;
  /** True if some trait bonus could not be counted (see notes). */
  incomplete: boolean;
}

const zero = (): SkillSet => ({
  diplomacy: 0,
  martial: 0,
  stewardship: 0,
  intrigue: 0,
  learning: 0,
  prowess: 0,
});

// The save stores only base skills. The game shows base + trait modifiers + perks +
// artifacts + temporary modifiers, computed at runtime. This adds what can be
// derived from the game files: each trait's fixed modifiers plus its XP-track tiers
// reached by the character. Without a `GameLookup` it returns the base values.
export function effectiveSkills(
  q: Query,
  loc: Localizer,
  lookup: GameLookup | null,
  id: number,
): EffectiveSkills {
  const arr = (q.at(`/living/${id}/skill`) as number[] | undefined) ?? [];
  const base = zero();
  SKILLS.forEach((s, i) => (base[s] = arr[i] ?? 0));
  const bonus = zero();
  let incomplete = false;

  if (lookup?.available) {
    const traitIdx = idList(q.at(`/living/${id}/traits`));
    const found = traitIdx.map((idx) => {
      const key = loc.traitIdentifier(idx);
      return { key, def: key ? lookup.skillsOfTrait(key) : null };
    });
    // trait_xp_amounts lists XP for the character's tracked traits, in trait order.
    const tracked = found.filter((t) => t.def && t.def.tracks.length > 0);
    const xp = idList(q.at(`/living/${id}/trait_xp_amounts`));
    const xpKnown = xp.length === tracked.length;
    if (tracked.length > 0 && !xpKnown) incomplete = true;

    let trackIndex = 0;
    for (const t of found) {
      if (!t.def) {
        incomplete = true; // trait missing from the game files (e.g. added by a mod)
        continue;
      }
      if (t.def.unresolved) incomplete = true;
      for (const s of SKILLS) bonus[s] += t.def.fixed[s] ?? 0;
      if (t.def.tracks.length > 0) {
        const amount = xpKnown ? (xp[trackIndex] ?? 0) : 0;
        trackIndex++;
        for (const tier of t.def.tracks)
          if (amount >= tier.threshold) for (const s of SKILLS) bonus[s] += tier.bonus[s] ?? 0;
      }
    }
  }

  const effective = zero();
  for (const s of SKILLS) effective[s] = base[s] + bonus[s];
  return { base, bonus, effective, incomplete };
}

/** "Dip 13 (6) | Mar 4 | ..." — the base value in brackets only where traits changed it. */
export function formatEffective(e: EffectiveSkills): string {
  const label: Record<Skill, string> = {
    diplomacy: "Dip",
    martial: "Mar",
    stewardship: "Stw",
    intrigue: "Int",
    learning: "Lrn",
    prowess: "Prw",
  };
  return SKILLS.map((s) =>
    e.bonus[s] === 0
      ? `${label[s]} ${e.effective[s]}`
      : `${label[s]} ${e.effective[s]} (${e.base[s]})`,
  ).join(" | ");
}

export const SKILL_NOTE =
  "Skills include trait bonuses read from the game files; the number in brackets is the base skill " +
  "saved in the game. Perks, artifacts and temporary modifiers are not included, so the in-game value " +
  "can be higher.";
