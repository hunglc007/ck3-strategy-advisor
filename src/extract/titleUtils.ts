import type { Query } from "../parser.js";
import type { Localizer } from "../localization.js";

// Display name for a numeric title id: current name -> 1.20 title_name_data
// (cultural/renamed name) -> localized key -> raw id.
export function resolveTitleName(q: Query, loc: Localizer, titleId: number): string {
  const base = `/landed_titles/landed_titles/${titleId}`;
  const name = q.at(`${base}/name`) as string | undefined;
  if (name !== undefined) return name;
  const dataName = q.at(`${base}/title_name_data/name`);
  if (typeof dataName === "string" && !/^[ekdcbh]_/.test(dataName)) return dataName;
  const key = q.at(`${base}/key`) as string | undefined;
  if (key !== undefined) return loc.resolve(key);
  return String(titleId);
}

export type TitleTier = "empire" | "kingdom" | "duchy" | "county" | "barony" | "other";

// Tier is encoded in the title key's prefix (e_/k_/d_/c_/b_).
export function titleTierFromKey(key: string): TitleTier {
  switch (key[0]) {
    case "e":
      return "empire";
    case "k":
      return "kingdom";
    case "d":
      return "duchy";
    case "c":
      return "county";
    case "b":
      return "barony";
    default:
      return "other";
  }
}
