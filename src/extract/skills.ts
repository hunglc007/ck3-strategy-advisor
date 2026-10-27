import type { Localizer } from "../localization.js";
import { SKILL_KEYS, type SkillBonus, type SkillName } from "../traitSkills.js";

export type Skills = Record<SkillName, number>;

export interface EffectiveSkills {
  /** Base + trait modifiers: what the game's character sheet shows. */
  total: Skills;
  base: Skills;
  traitBonus: Skills;
}

function zero(): Skills {
  return { diplomacy: 0, martial: 0, stewardship: 0, intrigue: 0, learning: 0, prowess: 0 };
}

function add(into: Skills, b: SkillBonus): void {
  for (const k of SKILL_KEYS) into[k] += b[k] ?? 0;
}

/**
 * The save stores only each character's base skills (`skill`, in the order
 * diplomacy, martial, stewardship, intrigue, learning, prowess). The in-game
 * value also includes skill modifiers from traits, so add those back using the
 * game's own trait definitions. Tracked traits (lifestyle perks etc.) add the
 * modifiers of every XP threshold the character has reached.
 *
 * Not included: modifiers from sources the save doesn't resolve for us
 * (culture/faith parameters, dynasty perks, artifacts, council-position or
 * temporary event modifiers). Without CK3_GAME_DIR there is no trait data, so
 * the total equals the base.
 */
export function effectiveSkills(
  loc: Localizer,
  baseArr: number[],
  traitIdx: number[],
  xpAmounts: number[],
): EffectiveSkills {
  const base = zero();
  SKILL_KEYS.forEach((k, i) => (base[k] = baseArr[i] ?? 0));

  const traitBonus = zero();
  let xpPos = 0;
  for (const idx of traitIdx) {
    const key = loc.traitKey(idx);
    const data = key ? loc.traitSkillData(key) : undefined;
    if (!data) continue;
    add(traitBonus, data.base);
    // trait_xp_amounts lists one value per track, in trait order.
    for (const track of data.tracks) {
      const xp = xpAmounts[xpPos++] ?? 0;
      for (const level of track) if (xp >= level.xp) add(traitBonus, level.bonus);
    }
  }

  const total = zero();
  for (const k of SKILL_KEYS) total[k] = base[k] + traitBonus[k];
  return { total, base, traitBonus };
}
