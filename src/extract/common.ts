import type { Query } from "../parser.js";

export function num(v: unknown): number | null {
  return typeof v === "number" ? v : null;
}

export function playerIdOf(q: Query): number {
  return q.at("/played_character/character") as number;
}

// A field that holds one id or a list of ids (CK3 writes `spouse=5` for one,
// `spouse={ 5 6 }` for several).
export function idList(v: unknown): number[] {
  if (typeof v === "number") return [v];
  if (Array.isArray(v)) return v.filter((x): x is number => typeof x === "number");
  return [];
}

// Living characters live under /living/{id}; dead ones that are still
// referenced under /dead_unprunable/{id}. jomini can return a dead entry as a
// [obj, obj] pair when the key repeats, so take the first object.
export function characterRecord(q: Query, id: number): Record<string, unknown> | null {
  const living = q.at(`/living/${id}`);
  if (living && typeof living === "object" && !Array.isArray(living))
    return living as Record<string, unknown>;
  const dead = q.at(`/dead_unprunable/${id}`);
  const rec = Array.isArray(dead) ? dead[0] : dead;
  return rec && typeof rec === "object" ? (rec as Record<string, unknown>) : null;
}

export function charName(q: Query, id: number): string {
  const rec = characterRecord(q, id);
  const name = rec?.["first_name"];
  return typeof name === "string" ? name : String(id);
}

function ymd(v: unknown): [number, number, number] | null {
  if (v instanceof Date) return [v.getUTCFullYear(), v.getUTCMonth() + 1, v.getUTCDate()];
  if (typeof v === "string") {
    const m = /^"?(\d+)\.(\d+)\.(\d+)/.exec(v);
    if (m) return [Number(m[1]), Number(m[2]), Number(m[3])];
  }
  return null;
}

// Whole years between a birth date and the save date (both CK3 dates).
export function ageAt(birth: unknown, date: unknown): number | null {
  const b = ymd(birth);
  const d = ymd(date);
  if (!b || !d) return null;
  let age = d[0] - b[0];
  if (d[1] < b[1] || (d[1] === b[1] && d[2] < b[2])) age--;
  return age;
}

export function characterAge(q: Query, id: number): number | null {
  const rec = characterRecord(q, id);
  return rec ? ageAt(rec["birth"], q.at("/date")) : null;
}

// Older saves keyed vassal contracts under /vassal_contracts/active; 1.20 uses
// /vassal_contracts/database (with "none" for vacated slots).
export function vassalContract(q: Query, cid: number): Record<string, unknown> | null {
  for (const base of ["database", "active"]) {
    const c = q.at(`/vassal_contracts/${base}/${cid}`);
    if (c && typeof c === "object") return c as Record<string, unknown>;
  }
  return null;
}

export interface CouncilSeat {
  task: string | null; // e.g. "task_collect_taxes"; null when the save lists bare character ids
  memberId: number;
}

// landed_data/council lists council *task* ids in 1.20 saves (resolved through
// /council_task_manager/active/{id} -> { type, owner }); older saves and the
// test fixture list character ids directly.
export function councilSeats(q: Query, playerId: number): CouncilSeat[] {
  const ids = (q.at(`/living/${playerId}/landed_data/council`) as number[] | undefined) ?? [];
  return ids.map((id) => {
    const task = q.at(`/council_task_manager/active/${id}`) as Record<string, unknown> | undefined;
    if (task && typeof task === "object" && typeof task["owner"] === "number")
      return {
        task: typeof task["type"] === "string" ? task["type"] : null,
        memberId: task["owner"],
      };
    return { task: null, memberId: id };
  });
}

export const SKILL_NAMES = [
  "diplomacy",
  "martial",
  "stewardship",
  "intrigue",
  "learning",
  "prowess",
] as const;
export type SkillName = (typeof SKILL_NAMES)[number];

export function skillsOf(q: Query, id: number): Record<SkillName, number> {
  const arr = (q.at(`/living/${id}/skill`) as number[] | undefined) ?? [];
  const out = {} as Record<SkillName, number>;
  SKILL_NAMES.forEach((s, i) => (out[s] = arr[i] ?? 0));
  return out;
}

export function formatSkills(s: Record<SkillName, number>): string {
  return (
    `Dip ${s.diplomacy} | Mar ${s.martial} | Stw ${s.stewardship} | ` +
    `Int ${s.intrigue} | Lrn ${s.learning} | Prw ${s.prowess}`
  );
}
