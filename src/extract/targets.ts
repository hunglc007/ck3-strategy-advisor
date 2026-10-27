import type { Query } from "../parser.js";
import type { Localizer } from "../localization.js";
import { resolveTitleName, titleTierFromKey } from "./titleUtils.js";
import { collectAllies, collectWars } from "./foreignRealm.js";

export type Route = "de_jure" | "claim" | "fabricate";

export interface Target {
  titleId: number;
  county: string;
  duchy: string;
  baronies: number;
  holderId: number;
  holder: string;
  holderStrength: number | null;
  holderGold: number | null;
  liege: { id: number; name: string; strength: number | null } | null;
  allies: number;
  atWar: boolean;
  /** de_jure: inside a duchy/kingdom you hold; claim: you hold a claim; fabricate: needs a claim first. */
  route: Route;
  /** Defender strength you would face: holder + liege (a vassal's liege normally joins). */
  defenderStrength: number | null;
  /** Your strength divided by defenderStrength; null when unknown. */
  odds: number | null;
}

export interface TargetsInfo {
  region: string;
  yourStrength: number | null;
  targets: Target[];
}

const ROUTE_RANK: Record<Route, number> = { de_jure: 0, claim: 1, fabricate: 2 };

function num(v: unknown): number | null {
  return typeof v === "number" ? v : null;
}

function name(q: Query, loc: Localizer, id: number): string {
  return loc.charName(q.at(`/living/${id}/first_name`) ?? "unknown");
}

/** Climb de_jure_liege from `id` until a kingdom/empire title; the start itself counts. */
function regionRoot(q: Query, id: number): number {
  let cur = id;
  for (let hop = 0; hop < 5; hop++) {
    const key = q.at(`/landed_titles/landed_titles/${cur}/key`) as string | undefined;
    if (key && (key[0] === "k" || key[0] === "e")) return cur;
    const up = q.at(`/landed_titles/landed_titles/${cur}/de_jure_liege`) as number | undefined;
    if (up === undefined) return cur;
    cur = up;
  }
  return cur;
}

function collectCounties(q: Query, id: number, out: number[], depth = 0): void {
  if (depth > 5) return;
  const key = q.at(`/landed_titles/landed_titles/${id}/key`) as string | undefined;
  if (key && titleTierFromKey(key) === "county") {
    out.push(id);
    return;
  }
  const kids = (q.at(`/landed_titles/landed_titles/${id}/de_jure_vassals`) as number[]) ?? [];
  for (const k of kids) collectCounties(q, k, out, depth + 1);
}

/**
 * Counties in the same de jure kingdom as the player's primary title that someone
 * else holds, ranked by how you would get at them and how weak the defender is.
 * The save has no map coordinates, so "near" means "same de jure region".
 */
export function extractTargets(
  q: Query,
  loc: Localizer,
  yourStrength: number | null,
): TargetsInfo | null {
  const playerId = q.at("/played_character/character") as number;
  const domain = (q.at(`/living/${playerId}/landed_data/domain`) as number[] | undefined) ?? [];
  if (domain[0] === undefined) return null;
  const rootId = regionRoot(q, domain[0]);
  const held = new Set(domain);

  const claims = new Set<number>();
  const rawClaims =
    (q.at(`/living/${playerId}/alive_data/claim`) as Array<{ title?: number }> | undefined) ?? [];
  for (const c of rawClaims) if (typeof c?.title === "number") claims.add(c.title);

  const counties: number[] = [];
  collectCounties(q, rootId, counties);

  const targets: Target[] = [];
  for (const id of counties) {
    const t = `/landed_titles/landed_titles/${id}`;
    const holderId = q.at(`${t}/holder`) as number | undefined;
    if (typeof holderId !== "number" || holderId === playerId) continue;

    const liegeTitle = q.at(`${t}/de_facto_liege`) as number | undefined;
    const liegeHolder =
      liegeTitle !== undefined
        ? (q.at(`/landed_titles/landed_titles/${liegeTitle}/holder`) as number | undefined)
        : undefined;
    if (liegeHolder === playerId) continue; // your own vassal's county

    const dejureDuchy = q.at(`${t}/de_jure_liege`) as number | undefined;
    const duchyHeldByYou = dejureDuchy !== undefined && held.has(dejureDuchy);
    const route: Route = claims.has(id) ? "claim" : duchyHeldByYou ? "de_jure" : "fabricate";

    const holderStrength = num(q.at(`/living/${holderId}/landed_data/strength`));
    const liege =
      typeof liegeHolder === "number"
        ? {
            id: liegeHolder,
            name: name(q, loc, liegeHolder),
            strength: num(q.at(`/living/${liegeHolder}/landed_data/strength`)),
          }
        : null;
    const defender =
      holderStrength === null && liege?.strength == null
        ? null
        : (holderStrength ?? 0) + (liege?.strength ?? 0);

    targets.push({
      titleId: id,
      county: resolveTitleName(q, loc, id),
      duchy: dejureDuchy !== undefined ? resolveTitleName(q, loc, dejureDuchy) : "?",
      baronies: ((q.at(`${t}/de_jure_vassals`) as number[] | undefined) ?? []).length,
      holderId,
      holder: name(q, loc, holderId),
      holderStrength,
      holderGold: num(q.at(`/living/${holderId}/alive_data/gold/value`)),
      liege,
      allies: collectAllies(q, loc, holderId).length,
      atWar: collectWars(q, loc, holderId).length > 0,
      route,
      defenderStrength: defender,
      odds: yourStrength !== null && defender ? yourStrength / defender : null,
    });
  }

  targets.sort(
    (a, b) =>
      ROUTE_RANK[a.route] - ROUTE_RANK[b.route] ||
      (a.defenderStrength ?? Infinity) * (1 + a.allies * 0.5) -
        (b.defenderStrength ?? Infinity) * (1 + b.allies * 0.5),
  );
  return { region: resolveTitleName(q, loc, rootId), yourStrength, targets };
}
