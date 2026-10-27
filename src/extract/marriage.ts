import type { Query } from "../parser.js";
import type { Localizer } from "../localization.js";
import { resolveTitleName } from "./titleUtils.js";
import { effectiveSkills, type Skills } from "./skills.js";

export interface MarriageCandidate {
  id: number;
  name: string;
  age: number;
  skills: Skills;
  traits: string[];
  fertility: number | null;
  /** Whose court she/he is in (or the candidate if landed); null for the unattached pool. */
  home: { id: number; name: string; realm: string | null; strength: number | null } | null;
  /** Home realm lies in the same de jure kingdom as your primary title. */
  nearby: boolean;
  /** Same culture as you (a cheap stand-in for distance, which the save does not give). */
  sameCulture: boolean;
  /** Your own court member. */
  inYourCourt: boolean;
  score: number;
}

export interface MarriageInfo {
  you: { id: number; name: string; age: number };
  faithMatched: number;
  candidates: MarriageCandidate[];
}

const MIN_AGE = 16;
const MAX_AGE = 45;

function num(v: unknown): number | null {
  return typeof v === "number" ? v : null;
}

function kingdomOf(q: Query, titleId: number | undefined): number | undefined {
  let cur = titleId;
  for (let hop = 0; cur !== undefined && hop < 5; hop++) {
    const key = q.at(`/landed_titles/landed_titles/${cur}/key`) as string | undefined;
    if (key && (key[0] === "k" || key[0] === "e")) return cur;
    cur = q.at(`/landed_titles/landed_titles/${cur}/de_jure_liege`) as number | undefined;
  }
  return undefined;
}

/**
 * Unmarried, same-faith, opposite-gender adults you could marry, best first. "Best"
 * weighs fertility (heirs), stewardship/diplomacy, how strong the home realm is as an
 * ally, and strongly prefers your de jure region and your culture (no distances in the save). Not in the save, so not checked: close kin
 * beyond your own house, existing betrothals, distance, and personality fit.
 */
export function extractMarriageCandidates(
  q: Query,
  loc: Localizer,
  nowYear: number,
  limit = 12,
): MarriageInfo | null {
  loc.setTraitLookup((q.at("/traits_lookup") as string[]) ?? null);
  const playerId = q.at("/played_character/character") as number;
  const me = q.at(`/living/${playerId}`) as Record<string, unknown> | undefined;
  if (!me) return null;
  const myFemale = me["female"] === true || me["female"] === "yes";
  const birth = me["birth"];
  const myAge = birth instanceof Date ? nowYear - birth.getUTCFullYear() : 0;

  const faithOf = (rite: unknown): number | undefined =>
    typeof rite === "number"
      ? (num(q.at(`/rites/database/${rite}/faith`)) ?? undefined)
      : undefined;
  const myFaith = faithOf(me["rite"]);
  const myHouse = me["dynasty_house"];

  const myDomain = (q.at(`/living/${playerId}/landed_data/domain`) as number[] | undefined) ?? [];
  const myKingdom = kingdomOf(q, myDomain[0]);

  const living = q.at("/living") as Record<string, Record<string, unknown>> | undefined;
  const found: MarriageCandidate[] = [];
  let faithMatched = 0;
  if (living) {
    const realmCache = new Map<number, MarriageCandidate["home"] & { nearby: boolean }>();
    const realmOf = (rulerId: number) => {
      let r = realmCache.get(rulerId);
      if (!r) {
        const dom = (q.at(`/living/${rulerId}/landed_data/domain`) as number[] | undefined) ?? [];
        r = {
          id: rulerId,
          name: String(q.at(`/living/${rulerId}/first_name`) ?? "unknown"),
          realm: dom[0] !== undefined ? resolveTitleName(q, loc, dom[0]) : null,
          strength: num(q.at(`/living/${rulerId}/landed_data/strength`)),
          nearby: myKingdom !== undefined && kingdomOf(q, dom[0]) === myKingdom,
        };
        realmCache.set(rulerId, r);
      }
      return r;
    };

    for (const [idStr, c] of Object.entries(living)) {
      if (!c || typeof c !== "object") continue;
      const id = Number(idStr);
      if (id === playerId) continue;
      const female = c["female"] === true || c["female"] === "yes";
      if (female === myFemale) continue;
      const b = c["birth"];
      if (!(b instanceof Date)) continue;
      const age = nowYear - b.getUTCFullYear();
      if (age < MIN_AGE || age > MAX_AGE) continue;
      const fam = c["family_data"] as Record<string, unknown> | undefined;
      if (fam && (fam["spouse"] !== undefined || fam["primary_spouse"] !== undefined)) continue;
      if (c["sexuality"] === "homosexual" || c["sexuality"] === "asexual") continue;
      if (myFaith === undefined || faithOf(c["rite"]) !== myFaith) continue;
      faithMatched++;
      if (myHouse !== undefined && c["dynasty_house"] === myHouse) continue; // assume close kin

      const court = c["court_data"] as Record<string, unknown> | undefined;
      const employer = num(court?.["employer"]);
      const landed = c["landed_data"] !== undefined;
      const homeId = employer ?? (landed ? id : null);
      const realm = homeId !== null ? realmOf(homeId) : null;
      const traitIdx = (c["traits"] as number[] | undefined) ?? [];
      const skills = effectiveSkills(
        loc,
        (c["skill"] as number[] | undefined) ?? [],
        traitIdx,
        (c["trait_xp_amounts"] as number[] | undefined) ?? [],
      ).total;
      const fertility = num(
        (c["alive_data"] as Record<string, unknown> | undefined)?.["fertility"],
      );
      const nearby = realm?.nearby ?? false;
      const sameCulture = me["culture"] !== undefined && c["culture"] === me["culture"];
      const score =
        (fertility ?? 0.5) * 10 +
        skills.stewardship +
        skills.diplomacy / 2 +
        Math.min(8, (realm?.strength ?? 0) / 400) +
        (nearby ? 10 : 0) +
        (sameCulture ? 4 : 0) -
        Math.max(0, age - 35) * 0.5;

      found.push({
        id,
        name: String(c["first_name"] ?? id),
        age,
        skills,
        traits: traitIdx.map((i) => loc.resolveTrait(i)),
        fertility,
        home: realm
          ? { id: realm.id, name: realm.name, realm: realm.realm, strength: realm.strength }
          : null,
        nearby,
        sameCulture,
        inYourCourt: employer === playerId,
        score,
      });
    }
  }

  // Local (same region or culture) first: skills alone would send a Munster king to Germany.
  const local = (c: MarriageCandidate) => Number(c.nearby || c.sameCulture);
  found.sort((a, b) => local(b) - local(a) || b.score - a.score);
  return {
    you: {
      id: playerId,
      name: String(me["first_name"] ?? playerId),
      age: myAge,
    },
    faithMatched,
    candidates: found.slice(0, limit),
  };
}
