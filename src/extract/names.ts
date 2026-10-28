import type { Query } from "../parser.js";
import type { Localizer } from "../localization.js";

/**
 * House name as the game shows it: the house's `prefix` key then its `name` key, each
 * localized (dynnp_d_ -> "d'", dynn_Ivrea -> "Ivrea"), e.g. "d'Ivrea".
 */
export function houseName(q: Query, loc: Localizer, houseId: unknown): string | null {
  if (typeof houseId !== "number") return null;
  const h = q.at(`/dynasties/dynasty_house/${houseId}`) as
    | { name?: unknown; prefix?: unknown }
    | undefined;
  if (!h || typeof h.name !== "string") return null;
  const prefix = typeof h.prefix === "string" ? loc.rawText(h.prefix) : "";
  return `${prefix}${loc.rawText(h.name)}`;
}

/** Full display name from an already loaded character record: first name, then house. */
export function fullNameOf(
  q: Query,
  loc: Localizer,
  c: Record<string, unknown> | undefined,
  fallback: string | number = "unknown",
): string {
  const first = loc.rawText(c?.["first_name"] ?? fallback);
  const house = houseName(q, loc, c?.["dynasty_house"]);
  return house ? `${first} ${house}` : first;
}

/** Full display name of the character with this id. */
export function fullName(q: Query, loc: Localizer, id: number): string {
  return fullNameOf(q, loc, q.at(`/living/${id}`) as Record<string, unknown> | undefined, id);
}
