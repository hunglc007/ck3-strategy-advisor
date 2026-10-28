import { queryGamestate, type Query } from "./parser.js";
import type { Localizer } from "./localization.js";
import { formatCk3Date } from "./format.js";
import { extractMilitary, type MilitaryInfo } from "./extract/military.js";
import { extractSuccession, type SuccessionInfo } from "./extract/succession.js";
import { extractDiplomacy, type DiplomacyInfo } from "./extract/diplomacy.js";
import {
  extractFactions,
  extractVassals,
  type FactionInfo,
  type VassalInfo,
} from "./extract/vassals.js";
import { extractExpansion, type ExpansionInfo } from "./extract/expansion.js";
import { extractTitles, type TitlesInfo } from "./extract/titles.js";
import { characterAge, idList, isLeasedTitle } from "./extract/common.js";

export interface RealmOverview {
  rulerName: string;
  date: string;
  primaryTitle: string;
  tier: number;
  house: string;
  gold: number | null;
  /** Spendable prestige (what the top bar shows). */
  prestige: number | null;
  /** Lifetime prestige, which drives prestige level. */
  prestigeLifetime: number | null;
  piety: number | null;
  age: number | null;
  /** Monthly gold income and net balance after expenses. */
  income: number | null;
  balance: number | null;
  legitimacy: number | null;
  government: string | null;
  laws: string[];
  spouses: number;
  /** Personally held holdings (baronies, excluding leased temples) vs the domain limit. */
  holdings: number;
  domainLimit: number | null;
  /** Vassals counting toward the vassal limit vs that limit. */
  vassalsTowardsLimit: number | null;
  vassalLimit: number | null;
}
export interface Snapshot {
  date: string;
  parsedAt: number;
  overview: RealmOverview;
  military: MilitaryInfo;
  succession: SuccessionInfo;
  diplomacy: DiplomacyInfo;
  factions: FactionInfo[];
  vassals: VassalInfo[];
  vassalCount: number;
  expansion: ExpansionInfo;
  titles: TitlesInfo;
}

function num(v: unknown): number | null {
  return typeof v === "number" ? v : null;
}
function str(v: unknown): string {
  return typeof v === "string" ? v : String(v ?? "");
}

export async function buildSnapshot(gamestate: Buffer, loc: Localizer): Promise<Snapshot> {
  return queryGamestate(gamestate, (q: Query): Snapshot => {
    loc.setTraitLookup((q.at("/traits_lookup") as string[]) ?? null);
    const date = formatCk3Date(q.at("/date"));
    const playerId = q.at("/played_character/character");
    const alive = `/living/${playerId}/alive_data`;
    const landed = `/living/${playerId}/landed_data`;
    const domain = (q.at(`${landed}/domain`) as number[] | undefined) ?? [];
    const holdings = domain.filter((t) => {
      const key = q.at(`/landed_titles/landed_titles/${t}/key`);
      return typeof key === "string" && key.startsWith("b_") && !isLeasedTitle(q, t);
    }).length;
    const laws = (q.at(`${landed}/laws`) as string[] | undefined) ?? [];
    const overview: RealmOverview = {
      rulerName: str(q.at("/meta_data/meta_player_name")),
      date,
      primaryTitle: str(q.at("/meta_data/meta_title_name")),
      tier: num(q.at("/meta_data/meta_player_tier")) ?? 0,
      house: str(q.at("/meta_data/meta_house_name")),
      gold: num(q.at(`${alive}/gold/value`)),
      // `currency` is the spendable amount; `accumulated` is the lifetime total.
      prestige:
        num(q.at(`${alive}/prestige/currency`)) ?? num(q.at(`${alive}/prestige/accumulated`)),
      prestigeLifetime: num(q.at(`${alive}/prestige/accumulated`)),
      piety: num(q.at(`${alive}/piety/currency`)) ?? num(q.at(`${alive}/piety/accumulated`)),
      age: characterAge(q, playerId as number),
      income: num(q.at(`${alive}/income`)),
      balance: num(q.at(`${landed}/balance`)),
      legitimacy: num(q.at(`/living/${playerId}/playable_data/legitimacy`)),
      government: (q.at(`${landed}/government`) as string | undefined) ?? null,
      laws: laws.map((l) => loc.resolve(l)),
      spouses: idList(q.at(`/living/${playerId}/family_data/spouse`)).length,
      holdings,
      domainLimit: num(q.at(`${landed}/domain_limit`)),
      vassalsTowardsLimit: num(q.at(`${landed}/vassals_towards_limit`)),
      vassalLimit: num(q.at(`${landed}/vassal_limit`)),
    };
    const military = extractMilitary(q, loc);
    const expansion = extractExpansion(q, loc, military.wars);
    const succession = extractSuccession(q, loc);
    const diplomacy = extractDiplomacy(q, loc);
    const { factions, memberIds } = extractFactions(q, loc);
    const { vassals, total: vassalCount } = extractVassals(q, loc, memberIds);
    const titles = extractTitles(q, loc);
    return {
      date,
      parsedAt: Date.now(),
      overview,
      military,
      expansion,
      succession,
      diplomacy,
      factions,
      vassals,
      vassalCount,
      titles,
    };
  });
}
