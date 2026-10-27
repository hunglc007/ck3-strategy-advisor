import type { Query } from "../parser.js";
import type { Localizer } from "../localization.js";
import {
  SKILL_NAMES,
  type SkillName,
  ageAt,
  councilSeats,
  playerIdOf,
  skillsOf,
} from "./common.js";

export interface CourtMember {
  id: number;
  name: string;
  age: number | null;
  skills: Record<SkillName, number>;
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
  /** Top courtiers per skill, with a note of the post they already hold. */
  bestBySkill: Record<SkillName, { member: CourtMember; holds: string | null }[]>;
}

function member(q: Query, loc: Localizer, id: number, date: unknown): CourtMember {
  const rec = q.at(`/living/${id}`) as Record<string, unknown> | undefined;
  const traits = ((rec?.["traits"] as number[] | undefined) ?? []).map((t) => loc.resolveTrait(t));
  return {
    id,
    name: typeof rec?.["first_name"] === "string" ? (rec["first_name"] as string) : String(id),
    age: ageAt(rec?.["birth"], date),
    skills: skillsOf(q, id),
    traits,
  };
}

export function extractCourt(q: Query, loc: Localizer, perSkill = 3): CourtInfo {
  const playerId = playerIdOf(q);
  const date = q.at("/date");
  const holds = new Map<number, string>();

  const council = councilSeats(q, playerId).map((s) => {
    const task = s.task ? loc.resolve(s.task) : "?";
    holds.set(s.memberId, `council: ${task}`);
    return { task, member: member(q, loc, s.memberId, date) };
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
    positions.push({ position, member: member(q, loc, p["employee"], date) });
  }

  const knightIds =
    (q.at(`/living/${playerId}/playable_data/knights`) as number[] | undefined) ?? [];
  const knights = knightIds
    .map((id) => member(q, loc, id, date))
    .sort((a, b) => b.skills.prowess - a.skills.prowess);

  // Courtiers: everyone whose court_data.employer is the player. One pass over
  // /living; skill ranking only needs the skill array, so build full members lazily.
  const living = (q.at("/living") as Record<string, unknown> | undefined) ?? {};
  const courtiers: { id: number; skills: number[] }[] = [];
  for (const [key, raw] of Object.entries(living)) {
    if (!raw || typeof raw !== "object") continue;
    const rec = raw as Record<string, unknown>;
    const court = rec["court_data"] as Record<string, unknown> | undefined;
    if (court?.["employer"] !== playerId) continue;
    courtiers.push({ id: Number(key), skills: (rec["skill"] as number[] | undefined) ?? [] });
  }

  const bestBySkill = {} as CourtInfo["bestBySkill"];
  SKILL_NAMES.forEach((skill, i) => {
    bestBySkill[skill] = [...courtiers]
      .sort((a, b) => (b.skills[i] ?? 0) - (a.skills[i] ?? 0))
      .slice(0, perSkill)
      .map((c) => ({ member: member(q, loc, c.id, date), holds: holds.get(c.id) ?? null }));
  });

  return { council, positions, knights, courtierCount: courtiers.length, bestBySkill };
}
