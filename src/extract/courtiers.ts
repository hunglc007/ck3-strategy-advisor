import type { Query } from "../parser.js";
import type { Localizer } from "../localization.js";
import { effectiveSkills, type Skills } from "./skills.js";
import { MILD_TRAITS, SEVERE_TRAITS } from "./council.js";

export interface PoolCharacter {
  id: number;
  name: string;
  age: number;
  female: boolean;
  skills: Skills;
  traits: string[];
  /** Why they are a worse pick despite their skills (empty when none). */
  flags: string[];
}

export type PoolScope = "kingdom" | "empire" | "all";

export interface PoolInfo {
  /** Region the candidates were limited to (a title key), or null when not limited. */
  region: string | null;
  /** Same-faith unattached adults before the region filter. */
  faithMatched: number;
  characters: PoolCharacter[];
}

const MIN_AGE = 16;
const MAX_AGE = 55;

function num(v: unknown): number | null {
  return typeof v === "number" ? v : null;
}

/**
 * Same-faith adults who belong to nobody's court and hold no land: the people you can
 * usually invite without taking anyone from another ruler. Where they are comes from their
 * province, mapped to a region with the game files (see provinces.ts).
 */
export function extractPool(
  q: Query,
  loc: Localizer,
  nowYear: number,
  scope: PoolScope = "empire",
): PoolInfo | null {
  loc.setTraitLookup((q.at("/traits_lookup") as string[]) ?? null);
  const playerId = q.at("/played_character/character") as number;
  const me = q.at(`/living/${playerId}`) as Record<string, unknown> | undefined;
  if (!me) return null;
  const faithOf = (rite: unknown): number | undefined =>
    typeof rite === "number"
      ? (num(q.at(`/rites/database/${rite}/faith`)) ?? undefined)
      : undefined;
  const myFaith = faithOf(me["rite"]);
  if (myFaith === undefined) return null;

  const provinceOf = (c: Record<string, unknown> | undefined): number | undefined =>
    num(
      (
        (c?.["alive_data"] as Record<string, unknown> | undefined)?.["location"] as
          | Record<string, unknown>
          | undefined
      )?.["location"],
    ) ?? undefined;
  const myProv = provinceOf(me);
  const myRegion = myProv !== undefined ? loc.provinceRegion(myProv) : undefined;
  // Without game files there is no map, so fall back to "everyone" rather than to nobody.
  const region =
    scope === "all" || !myRegion
      ? null
      : scope === "kingdom"
        ? myRegion.kingdom
        : (myRegion.empire ?? myRegion.kingdom);
  const inRegion = (c: Record<string, unknown>): boolean => {
    if (region === null) return true;
    const p = provinceOf(c);
    const r = p !== undefined ? loc.provinceRegion(p) : undefined;
    return scope === "kingdom" ? r?.kingdom === region : (r?.empire ?? r?.kingdom) === region;
  };

  const living = q.at("/living") as Record<string, Record<string, unknown>> | undefined;
  const characters: PoolCharacter[] = [];
  let faithMatched = 0;
  for (const [idStr, c] of Object.entries(living ?? {})) {
    if (!c || typeof c !== "object") continue;
    const b = c["birth"];
    if (!(b instanceof Date)) continue;
    const age = nowYear - b.getUTCFullYear();
    if (age < MIN_AGE || age > MAX_AGE) continue;
    if (c["landed_data"] !== undefined) continue;
    const court = c["court_data"] as Record<string, unknown> | undefined;
    if (num(court?.["employer"]) !== null) continue;
    if (faithOf(c["rite"]) !== myFaith) continue;
    faithMatched++;
    if (!inRegion(c)) continue;

    const idx = (c["traits"] as number[] | undefined) ?? [];
    const keys = idx.map((i) => loc.traitKey(i) ?? "");
    const flags: string[] = [];
    if (keys.some((k) => SEVERE_TRAITS.test(k))) flags.push("severe mental/physical trait");
    else if (keys.some((k) => MILD_TRAITS.test(k))) flags.push("unreliable trait");
    characters.push({
      id: Number(idStr),
      name: loc.charName(c["first_name"] ?? idStr),
      age,
      female: c["female"] === true || c["female"] === "yes",
      skills: effectiveSkills(
        loc,
        (c["skill"] as number[] | undefined) ?? [],
        idx,
        (c["trait_xp_amounts"] as number[] | undefined) ?? [],
      ).total,
      traits: idx.map((i) => loc.resolveTrait(i)),
      flags,
    });
  }
  return { region, faithMatched, characters };
}
