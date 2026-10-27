import type { Query } from "../parser.js";
import type { Localizer } from "../localization.js";
import { effectiveSkills } from "./skills.js";

export type CouncilRole = "chancellor" | "steward" | "marshal" | "spymaster" | "court_chaplain";
export type SkillKey = "diplomacy" | "martial" | "stewardship" | "intrigue" | "learning";

export const ROLE_SKILL: Record<CouncilRole, SkillKey> = {
  chancellor: "diplomacy",
  steward: "stewardship",
  marshal: "martial",
  spymaster: "intrigue",
  court_chaplain: "learning",
};

const TASK_ROLE: Record<string, CouncilRole> = {
  task_foreign_affairs: "chancellor",
  task_collect_taxes: "steward",
  task_organize_levies: "marshal",
  task_disrupt_schemes: "spymaster",
  task_religious_relations: "court_chaplain",
};

export interface Courtier {
  id: number;
  name: string;
  age: number | null;
  skills: Record<SkillKey, number> & { prowess: number };
  traits: string[];
  knight: boolean;
  seat: CouncilRole | null;
}

export interface CouncilInfo {
  /** Courtiers employed by the player (council members included), highest skill first is up to callers. */
  courtiers: Courtier[];
  /** Seats currently filled, by role; null seats are frozen/vacant. */
  seats: Record<CouncilRole, number | null>;
}

const ADULT_AGE = 16;

export function extractCouncil(q: Query, loc: Localizer, nowYear: number | null): CouncilInfo {
  const playerId = q.at("/played_character/character") as number;
  const seats: Record<CouncilRole, number | null> = {
    chancellor: null,
    steward: null,
    marshal: null,
    spymaster: null,
    court_chaplain: null,
  };
  const seatOf = new Map<number, CouncilRole>();

  const active = q.at("/council_task_manager/active") as Record<string, unknown> | undefined;
  if (active && typeof active === "object") {
    for (const v of Object.values(active)) {
      if (!v || typeof v !== "object") continue;
      const t = v as Record<string, unknown>;
      if (t["court_owner"] !== playerId) continue;
      const role = TASK_ROLE[String(t["type"])];
      if (!role) continue;
      const owner = t["owner"];
      if (typeof owner === "number") {
        seats[role] = owner;
        seatOf.set(owner, role);
      }
    }
  }

  const living = q.at("/living") as Record<string, unknown> | undefined;
  const courtiers: Courtier[] = [];
  if (living && typeof living === "object") {
    for (const [idStr, raw] of Object.entries(living)) {
      if (!raw || typeof raw !== "object") continue;
      const c = raw as Record<string, unknown>;
      const court = c["court_data"] as Record<string, unknown> | undefined;
      if (!court || court["employer"] !== playerId) continue;
      const id = Number(idStr);
      const traitIdx = (c["traits"] as number[] | undefined) ?? [];
      const skills = effectiveSkills(
        loc,
        (c["skill"] as number[] | undefined) ?? [],
        traitIdx,
        (c["trait_xp_amounts"] as number[] | undefined) ?? [],
      ).total;
      const birth = c["birth"];
      const birthYear = birth instanceof Date ? birth.getUTCFullYear() : null;
      courtiers.push({
        id,
        name: String(c["first_name"] ?? id),
        age: birthYear !== null && nowYear !== null ? nowYear - birthYear : null,
        skills,
        traits: traitIdx.map((i) => loc.resolveTrait(i)),
        knight: court["knight"] === true || court["knight"] === "yes",
        seat: seatOf.get(id) ?? null,
      });
    }
  }
  return { courtiers, seats };
}

export interface Assignment {
  role: CouncilRole;
  current: Courtier | null;
  suggested: Courtier | null;
  gain: number;
}

/**
 * Best one-person-per-seat assignment maximising the sum of each seat's primary
 * skill. Only adults are eligible. Exhaustive search is fine: 5 seats.
 */
export function suggestCouncil(info: CouncilInfo): Assignment[] {
  const roles = Object.keys(ROLE_SKILL) as CouncilRole[];
  const pool = info.courtiers.filter((c) => c.age === null || c.age >= ADULT_AGE);
  const byId = new Map(info.courtiers.map((c) => [c.id, c]));

  let best: (Courtier | null)[] = roles.map(() => null);
  let bestScore = -1;
  const pick: (Courtier | null)[] = roles.map(() => null);
  const used = new Set<number>();
  const go = (i: number, score: number) => {
    if (i === roles.length) {
      if (score > bestScore) {
        bestScore = score;
        best = [...pick];
      }
      return;
    }
    const skill = ROLE_SKILL[roles[i]!];
    for (const c of pool) {
      if (used.has(c.id)) continue;
      used.add(c.id);
      pick[i] = c;
      // Tiny bonus so ties keep the current holder rather than shuffling for +0.
      go(i + 1, score + c.skills[skill] + (info.seats[roles[i]!] === c.id ? 0.01 : 0));
      used.delete(c.id);
    }
    pick[i] = null;
    go(i + 1, score);
  };
  go(0, 0);

  return roles.map((role, i) => {
    const curId = info.seats[role];
    const current = curId !== null ? (byId.get(curId) ?? null) : null;
    const suggested = best[i] ?? null;
    const skill = ROLE_SKILL[role];
    return {
      role,
      current,
      suggested,
      gain: (suggested?.skills[skill] ?? 0) - (current?.skills[skill] ?? 0),
    };
  });
}
