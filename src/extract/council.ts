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
  /** Raw trait keys (e.g. "lunatic_1"), used for risk scoring. */
  traitKeys: string[];
  knight: boolean;
  seat: CouncilRole | null;
  /** Landed direct vassal of the player rather than a courtier. */
  vassal: boolean;
  sameHouse: boolean;
  health: number | null;
  /** Summed temporary opinion of the player; null when none is stored. */
  opinion: number | null;
  /** Claim on a title the player holds: "pressed" is an active threat, "unpressed" a latent one. */
  claim: "pressed" | "unpressed" | null;
  inFaction: boolean;
}

export interface CouncilInfo {
  /** Everyone who can sit on the council: the player's courtiers, direct vassals and seat holders. */
  courtiers: Courtier[];
  /** Seats currently filled, by role; null seats are vacant. */
  seats: Record<CouncilRole, number | null>;
}

const ADULT_AGE = 16;
/** A penalty at or above this makes someone ineligible rather than merely worse. */
const DISQUALIFY = 100;

export const SEVERE_TRAITS = /^(lunatic_[23]|possessed_\d|incapable|infirm|maimed|dull)$/;
export const MILD_TRAITS = /^(lunatic_1|depressed_\d|ill|pneumonic|lazy|stuttering)$/;

/** Reasons a character is a risky or poor council pick; empty when none apply. */
export function riskNotes(c: Courtier): string[] {
  const n: string[] = [];
  if (c.claim === "pressed") n.push("has a pressed claim on your titles");
  else if (c.claim === "unpressed") n.push("has an unpressed claim on your titles");
  if (c.inFaction) n.push("in a faction against you");
  if (c.opinion !== null && c.opinion < 0) n.push(`opinion of you ${c.opinion}`);
  if (c.age !== null && c.age >= 70) n.push(`very old (${c.age})`);
  else if (c.age !== null && c.age >= 60) n.push(`old (${c.age})`);
  if (c.health !== null && c.health < 3) n.push(`frail (health ${c.health.toFixed(1)})`);
  if (c.traitKeys.some((k) => SEVERE_TRAITS.test(k))) n.push("severe mental/physical trait");
  else if (c.traitKeys.some((k) => MILD_TRAITS.test(k))) n.push("unreliable trait");
  return n;
}

/** Score deducted from a candidate for the risks in `riskNotes` (skill points). */
export function riskPenalty(c: Courtier): number {
  let p = 0;
  if (c.claim === "pressed") p += DISQUALIFY;
  else if (c.claim === "unpressed") p += 1;
  if (c.inFaction) p += DISQUALIFY;
  if (c.opinion !== null && c.opinion < 0) p += Math.min(8, -c.opinion / 5);
  if (c.age !== null && c.age >= 70) p += 4;
  else if (c.age !== null && c.age >= 60) p += 1.5;
  if (c.health !== null && c.health < 3) p += 4;
  if (c.traitKeys.some((k) => SEVERE_TRAITS.test(k))) p += 6;
  else if (c.traitKeys.some((k) => MILD_TRAITS.test(k))) p += 2;
  return p;
}

function num(v: unknown): number | null {
  return typeof v === "number" ? v : null;
}

/** Titles the player holds himself: only claims on these threaten him (not on his liege). */
function playerTitleSet(q: Query, playerId: number): Set<number> {
  return new Set((q.at(`/living/${playerId}/landed_data/domain`) as number[] | undefined) ?? []);
}

export function extractCouncil(
  q: Query,
  loc: Localizer,
  nowYear: number | null,
  factionMemberIds: Set<number> = new Set(),
): CouncilInfo {
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

  // Direct vassals can sit on the council too (and often hold a seat), so they are candidates.
  const vassalIds = new Set<number>();
  for (const cid of (q.at(`/living/${playerId}/landed_data/vassal_contracts`) as number[]) ?? []) {
    const contract = (q.at(`/vassal_contracts/database/${cid}`) ??
      q.at(`/vassal_contracts/active/${cid}`)) as Record<string, unknown> | undefined;
    const vassal = contract?.["vassal"];
    if (typeof vassal === "number") vassalIds.add(vassal);
  }

  const houseId = q.at(`/living/${playerId}/dynasty_house`);
  const yourTitles = playerTitleSet(q, playerId);

  const living = q.at("/living") as Record<string, unknown> | undefined;
  const found: Array<{ id: number; c: Record<string, unknown> }> = [];
  if (living && typeof living === "object") {
    for (const [idStr, raw] of Object.entries(living)) {
      if (!raw || typeof raw !== "object") continue;
      const c = raw as Record<string, unknown>;
      const id = Number(idStr);
      const court = c["court_data"] as Record<string, unknown> | undefined;
      const employed = court?.["employer"] === playerId;
      if (!employed && !vassalIds.has(id) && !seatOf.has(id)) continue;
      if (id === playerId) continue;
      found.push({ id, c });
    }
  }

  // One pass over opinions, only for the people we care about.
  const wanted = new Set(found.map((f) => f.id));
  const opinionMap = new Map<number, number>();
  const opinions =
    (q.at("/opinions/active_opinions") as Record<string, unknown>[] | undefined) ?? [];
  for (const e of opinions) {
    if (!e || typeof e !== "object" || e["target"] !== playerId) continue;
    const owner = e["owner"];
    if (typeof owner !== "number" || !wanted.has(owner)) continue;
    const value = (e["temporary_opinion"] as Record<string, unknown> | undefined)?.["value"];
    if (typeof value === "number") opinionMap.set(owner, (opinionMap.get(owner) ?? 0) + value);
  }

  const courtiers: Courtier[] = found.map(({ id, c }) => {
    const traitIdx = (c["traits"] as number[] | undefined) ?? [];
    const skills = effectiveSkills(
      loc,
      (c["skill"] as number[] | undefined) ?? [],
      traitIdx,
      (c["trait_xp_amounts"] as number[] | undefined) ?? [],
    ).total;
    const birth = c["birth"];
    const birthYear = birth instanceof Date ? birth.getUTCFullYear() : null;
    const alive = c["alive_data"] as Record<string, unknown> | undefined;
    const claims =
      (alive?.["claim"] as Array<{ title?: number; pressed?: unknown }> | undefined) ?? [];
    const onYou = claims.filter((cl) => typeof cl?.title === "number" && yourTitles.has(cl.title));
    const court = c["court_data"] as Record<string, unknown> | undefined;
    return {
      id,
      name: String(c["first_name"] ?? id),
      age: birthYear !== null && nowYear !== null ? nowYear - birthYear : null,
      skills,
      traits: traitIdx.map((i) => loc.resolveTrait(i)),
      traitKeys: traitIdx.map((i) => loc.traitKey(i) ?? ""),
      knight: court?.["knight"] === true || court?.["knight"] === "yes",
      seat: seatOf.get(id) ?? null,
      vassal: vassalIds.has(id),
      sameHouse: houseId !== undefined && c["dynasty_house"] === houseId,
      health: num(alive?.["health"]),
      opinion: opinionMap.has(id) ? opinionMap.get(id)! : null,
      claim:
        onYou.length === 0
          ? null
          : onYou.some((cl) => cl.pressed === true || cl.pressed === "yes")
            ? "pressed"
            : "unpressed",
      inFaction: factionMemberIds.has(id),
    };
  });
  return { courtiers, seats };
}

export interface Assignment {
  role: CouncilRole;
  current: Courtier | null;
  suggested: Courtier | null;
  /** Risk-adjusted score difference: suggested minus current. */
  gain: number;
  /** Next-best eligible candidates for this seat, ignoring who else is picked. */
  alternatives: Courtier[];
}

function score(c: Courtier, role: CouncilRole): number {
  return c.skills[ROLE_SKILL[role]] - riskPenalty(c);
}

/**
 * Best one-person-per-seat assignment maximising the sum of each seat's primary
 * skill minus a risk penalty (age, health, opinion, claims on your titles,
 * faction membership, bad traits). Only adults are eligible; anyone with a
 * disqualifying risk is skipped. Exhaustive search is fine: 5 seats.
 */
export function suggestCouncil(info: CouncilInfo): Assignment[] {
  const roles = Object.keys(ROLE_SKILL) as CouncilRole[];
  const pool = info.courtiers.filter(
    (c) => (c.age === null || c.age >= ADULT_AGE) && riskPenalty(c) < DISQUALIFY,
  );
  const byId = new Map(info.courtiers.map((c) => [c.id, c]));

  let best: (Courtier | null)[] = roles.map(() => null);
  let bestScore = -Infinity;
  const pick: (Courtier | null)[] = roles.map(() => null);
  const used = new Set<number>();
  const go = (i: number, total: number) => {
    if (i === roles.length) {
      if (total > bestScore) {
        bestScore = total;
        best = [...pick];
      }
      return;
    }
    const role = roles[i]!;
    for (const c of pool) {
      if (used.has(c.id)) continue;
      used.add(c.id);
      pick[i] = c;
      // Tiny bonus so ties keep the current holder rather than shuffling for +0.
      go(i + 1, total + Math.max(score(c, role), 0) + (info.seats[role] === c.id ? 0.01 : 0));
      used.delete(c.id);
    }
    pick[i] = null;
    go(i + 1, total);
  };
  go(0, 0);

  return roles.map((role, i) => {
    const curId = info.seats[role];
    const current = curId !== null ? (byId.get(curId) ?? null) : null;
    const suggested = best[i] ?? null;
    const alternatives = pool
      .filter((c) => c.id !== suggested?.id)
      .sort((a, b) => score(b, role) - score(a, role))
      .slice(0, 3);
    return {
      role,
      current,
      suggested,
      gain: (suggested ? score(suggested, role) : 0) - (current ? score(current, role) : 0),
      alternatives,
    };
  });
}
