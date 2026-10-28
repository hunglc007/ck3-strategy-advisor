import type { Query } from "../parser.js";
import type { Localizer } from "../localization.js";
import type { GameData } from "../gameData.js";
import { num, playerIdOf, isLeasedTitle } from "./common.js";
import { resolveTitleName } from "./titleUtils.js";

export interface Holding {
  title: string;
  province: number | null;
  type: string | null; // localized holding type, e.g. "Castle"
  buildings: string[];
  emptySlots: number;
  levy: number | null;
  garrison: number | null;
  income: number | null;
  fortLevel: number | null;
  isCapital: boolean;
  /** A temple leased out to the church: shown, but not counted against the domain limit. */
  leased: boolean;
}
export interface County {
  title: string;
  development: number | null;
  control: number | null;
  culture: string | null;
  holdings: Holding[];
}
export interface DomainInfo {
  counties: County[];
  /** Baronies held directly whose county is not held by the player. */
  looseHoldings: Holding[];
  holdingCount: number;
  domainLimit: number | null;
}

function cultureName(q: Query, id: unknown): string | null {
  if (typeof id !== "number") return null;
  const name = q.at(`/culture_manager/cultures/${id}/name`);
  return typeof name === "string" ? name : null;
}

// Personally held land: counties (development/control from /county_manager,
// keyed by county *key*) and baronies (holding/buildings/levy from
// /provinces/{id}, where the barony->province id comes from the game files).
export function extractDomain(q: Query, loc: Localizer, game: GameData): DomainInfo {
  const playerId = playerIdOf(q);
  const landed = `/living/${playerId}/landed_data`;
  const domain = (q.at(`${landed}/domain`) as number[] | undefined) ?? [];
  const capital = q.at(`${landed}/realm_capital`);
  const titleAt = (id: number) =>
    (q.at(`/landed_titles/landed_titles/${id}`) as Record<string, unknown> | undefined) ?? {};

  const holding = (id: number): Holding => {
    const key = String(titleAt(id)["key"] ?? "");
    const province = game.baronyProvince.get(key) ?? null;
    const prov =
      province !== null
        ? ((q.at(`/provinces/${province}`) as Record<string, unknown> | undefined) ?? {})
        : {};
    const h = (prov["holding"] as Record<string, unknown> | undefined) ?? {};
    const buildings = (h["buildings"] as Record<string, unknown>[] | undefined) ?? [];
    const type = typeof h["type"] === "string" ? loc.resolve(h["type"] as string) : null;
    return {
      title: resolveTitleName(q, loc, id),
      province,
      type,
      buildings: buildings
        .map((b) => b?.["type"])
        .filter((t): t is string => typeof t === "string")
        .map((t) => loc.resolve(`building_${t}`)),
      emptySlots: buildings.filter((b) => !b || b["type"] === undefined).length,
      levy: num(h["levy"]),
      garrison: num(h["garrison"]),
      income: num(h["income"]),
      fortLevel: num(prov["fort_level"]),
      isCapital: id === capital,
      leased: isLeasedTitle(q, id),
    };
  };

  const countyIds = domain.filter((id) => String(titleAt(id)["key"] ?? "").startsWith("c_"));
  const baronyIds = domain.filter((id) => String(titleAt(id)["key"] ?? "").startsWith("b_"));
  const placed = new Set<number>();

  const counties: County[] = countyIds.map((cid) => {
    const key = String(titleAt(cid)["key"]);
    const cm =
      (q.at(`/county_manager/counties/${key}`) as Record<string, unknown> | undefined) ?? {};
    const holdings = baronyIds
      .filter((b) => titleAt(b)["de_jure_liege"] === cid || titleAt(b)["de_facto_liege"] === cid)
      .map((b) => {
        placed.add(b);
        return holding(b);
      });
    return {
      title: resolveTitleName(q, loc, cid),
      development: num(cm["development"]),
      control: num(cm["county_control"]),
      culture: cultureName(q, cm["culture"]),
      holdings,
    };
  });

  return {
    counties,
    looseHoldings: baronyIds.filter((b) => !placed.has(b)).map(holding),
    holdingCount: baronyIds.filter((b) => !isLeasedTitle(q, b)).length,
    domainLimit: num(q.at(`${landed}/domain_limit`)),
  };
}
