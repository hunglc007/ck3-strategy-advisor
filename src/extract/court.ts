import type { Query } from "../parser.js";
import type { Localizer } from "../localization.js";
import type { GameLookup } from "../gameLookup.js";
import { SKILL_NAMES, type SkillName, ageAt, councilSeats, playerIdOf } from "./common.js";
import { effectiveSkills, type EffectiveSkills } from "./skills.js";

export interface CourtMember {
  id: number;
  name: string;
  age: number | null;
  /** Base skills plus trait bonuses (see `effectiveSkills`); `skills.base` is the saved value. */
  skills: EffectiveSkills;
  traits: string[];
}
export interface CouncilEntry {
  task: string; // localized current council task (or "?" if unknown)
  member: CourtMember;
}
export interface CourtPositionEntry {
  position: string; // localized court position
  member: CourtMember;
}
export interface CourtInfo {
  council: CouncilEntry[];
  positions: CourtPositionEntry[];
  knights: CourtMember[];
  courtierCount: number;
  /** Top courtiers per skill (by effective skill), with the post they already hold. */
  bestBySkill: Record<SkillName, { member: CourtMember; holds: string | null }[]>;
}

export function extractCourt(
  q: Query,
  loc: Localizer,
  lookup: GameLookup | null = null,
  perSkill = 3,
): CourtInfo {
  const playerId = playerIdOf(q);
  const date = q.at("/date");
  const holds = new Map<number, string>();

  const member = (id: number): CourtMember => {
    const rec = q.at(`/living/${id}`) as Record<string, unknown> | undefined;
    const traits = ((rec?.["traits"] as number[] | undefined) ?? []).map((t) =>
      loc.resolveTrait(t),
    );
    return {
      id,
      name: typeof rec?.["first_name"] === "string" ? (rec["first_name"] as string) : String(id),
      age: ageAt(rec?.["birth"], date),
      skills: effectiveSkills(q, loc, lookup, id),
      traits,
    };
  };

  const council = councilSeats(q, playerId).map((s) => {
    const task = s.task ? loc.resolve(s.task) : "?";
    holds.set(s.memberId, `council: ${task}`);
    return { task, member: member(s.memberId) };
  });

  // /court_positions/database is keyed by an internal id; filter to our court.
  const db = (q.at("/court_positions/database") as Record<string, unknown> | undefined) ?? {};
  const positions: CourtPositionEntry[] = [];
  for (const raw of Object.values(db)) {
    if (!raw || typeof raw !== "object") continue;
    const p = raw as Record<string, unknown>;
    if (p["employer"] !== playerId || typeof p["employee"] !== "number") continue;
    const position = loc.resolve(String(p["court_position"]));
    holds.set(p["employee"], position);
    positions.push({ position, member: member(p["employee"]) });
  }

  const knightIds =
    (q.at(`/living/${playerId}/playable_data/knights`) as number[] | undefined) ?? [];
  const knights = knightIds
    .map(member)
    .sort((a, b) => b.skills.effective.prowess - a.skills.effective.prowess);

  // Courtiers: everyone whose court_data.employer is the player.
  const living = (q.at("/living") as Record<string, unknown> | undefined) ?? {};
  const courtiers: CourtMember[] = [];
  for (const [key, raw] of Object.entries(living)) {
    if (!raw || typeof raw !== "object") continue;
    const court = (raw as Record<string, unknown>)["court_data"] as
      | Record<string, unknown>
      | undefined;
    if (court?.["employer"] !== playerId) continue;
    courtiers.push(member(Number(key)));
  }

  const bestBySkill = {} as CourtInfo["bestBySkill"];
  for (const skill of SKILL_NAMES) {
    bestBySkill[skill] = [...courtiers]
      .sort((a, b) => b.skills.effective[skill] - a.skills.effective[skill])
      .slice(0, perSkill)
      .map((m) => ({ member: m, holds: holds.get(m.id) ?? null }));
  }

  return { council, positions, knights, courtierCount: courtiers.length, bestBySkill };
}
