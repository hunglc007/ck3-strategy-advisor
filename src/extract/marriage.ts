import type { Query } from "../parser.js";
import { fullName, fullNameOf } from "./names.js";
import type { Localizer } from "../localization.js";
import { resolveTitleName } from "./titleUtils.js";
import { effectiveSkills, type Skills } from "./skills.js";

export interface AllyRuler {
  id: number;
  name: string;
  /** Army strength of that ruler. */
  strength: number;
  relation: "self" | "parent" | "sibling" | "child";
}

export interface MarriageCandidate {
  id: number;
  name: string;
  age: number;
  skills: Skills;
  traits: string[];
  /** Heritable good/bad traits (genetic quality of future children). */
  goodGenes: string[];
  badGenes: string[];
  /** Titles they hold a claim on (up to 4), a possible future claim for your children. */
  claims: string[];
  fertility: number | null;
  /** Whose court she/he is in (or the candidate if landed); null for the unattached pool. */
  home: { id: number; name: string; realm: string | null; strength: number | null } | null;
  /** Home realm lies in the same de jure kingdom as your primary title. */
  nearby: boolean;
  /** Same culture as you (a cheap stand-in for distance, which the save does not give). */
  sameCulture: boolean;
  /**
   * Relation to the ruler whose court they are in: only a close relative (daughter or
   * sister, read from the living and dead parents' child lists) normally gives a marriage
   * alliance. "self" when the candidate is the ruler; null for a mere courtier or unknown.
   */
  kinOfRuler: "daughter" | "sister" | "self" | null;
  /** Strongest ruler among their close family (parents, siblings, children) or themselves. */
  allyRuler: AllyRuler | null;
  /** Map distance from the player's location, when known. */
  distance: number | null;
  /** Your own court member. */
  inYourCourt: boolean;
  /** Default blend: local first, then fertility/skills/ally strength/genes. */
  score: number;
  /** Alliance strength tier first, then youth+fertility, skills, genes, claims. */
  priorityScore: number;
}

export interface MarriageInfo {
  you: { id: number; name: string; age: number };
  faithMatched: number;
  candidates: MarriageCandidate[];
}

export type MarriageRank = "local" | "priority";

const GOOD_GENES = /^((beauty|intellect|physique)_good_d|fecund|pure_blooded)$/;
const BAD_GENES =
  /^((beauty|intellect|physique)_bad_d|inbred|bleeder|clubfooted|hunchbacked|lisping|stuttering|weak|dull|spindly|scaly|albino|wheezing|infertile)$/;

/** The game only lists people within diplomatic range (capped at 1000 game units); 1130 map units reproduces the ~480 candidates seen around Munster. */
const DEFAULT_RANGE = 1130;
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
  opts: {
    rank?: MarriageRank;
    minHomeStrength?: number;
    forCharacter?: number;
    /** Only people currently located in these empires/kingdoms (title keys, e.g. e_britannia, k_france). */
    regions?: string[];
    /**
     * Only people within this map distance of the player's location. The default roughly matches
     * the in-game marriage list (calibrated so a Munster ruler sees about 450 candidates).
     */
    maxDistance?: number;
  } = {},
): MarriageInfo | null {
  loc.setTraitLookup((q.at("/traits_lookup") as string[]) ?? null);
  const playerId = q.at("/played_character/character") as number;
  const myProvince = ((q.at(`/living/${playerId}/alive_data/location`) as
    | Record<string, unknown>
    | undefined) ?? {})["location"] as number | undefined;
  // The person being married: the player by default, or e.g. the heir.
  const subjectId = opts.forCharacter ?? playerId;
  const me = q.at(`/living/${subjectId}`) as Record<string, unknown> | undefined;
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
  // child -> parents, from living and dead characters, to recognise a ruler's daughters and sisters.
  const parentsOf = new Map<number, number[]>();
  const childrenOf = new Map<number, number[]>();
  const addFamilies = (src: unknown) => {
    if (!src || typeof src !== "object") return;
    for (const [pid, ch] of Object.entries(src as Record<string, Record<string, unknown>>)) {
      const kids = (ch?.["family_data"] as Record<string, unknown> | undefined)?.["child"];
      if (!Array.isArray(kids)) continue;
      childrenOf.set(
        Number(pid),
        kids.filter((k): k is number => typeof k === "number"),
      );
      for (const k of kids) {
        if (typeof k !== "number") continue;
        const arr = parentsOf.get(k);
        if (arr) arr.push(Number(pid));
        else parentsOf.set(k, [Number(pid)]);
      }
    }
  };
  addFamilies(living);
  addFamilies(q.at("/dead_unprunable"));
  const kinOf = (id: number, rulerId: number | null): MarriageCandidate["kinOfRuler"] => {
    if (rulerId === null) return null;
    if (rulerId === id) return "self";
    const mine = parentsOf.get(id) ?? [];
    if (mine.includes(rulerId)) return "daughter";
    const theirs = parentsOf.get(rulerId) ?? [];
    return mine.some((p) => theirs.includes(p)) ? "sister" : null;
  };

  /**
   * The game's rule for a marriage alliance (marriage_between_characters_unlocks_alliance): the
   * spouse is a ruler, or has a ruler among their close family. Close family here is parents,
   * children and siblings. Returns the strongest such ruler.
   */
  const strengthOf = (id: number): number | null => num(q.at(`/living/${id}/landed_data/strength`));
  const allyRulerOf = (id: number, own: Record<string, unknown>): AllyRuler | null => {
    const kin = new Set<number>([id]);
    const parents = parentsOf.get(id) ?? [];
    for (const p of parents) {
      kin.add(p);
      for (const s of childrenOf.get(p) ?? []) kin.add(s);
    }
    for (const ch of childrenOf.get(id) ?? []) kin.add(ch);
    void own;
    let best: AllyRuler | null = null;
    for (const k of kin) {
      const s = strengthOf(k);
      if (s === null || (best !== null && s <= best.strength)) continue;
      best = {
        id: k,
        name: fullName(q, loc, k),
        strength: s,
        relation:
          k === id
            ? "self"
            : parents.includes(k)
              ? "parent"
              : (childrenOf.get(id) ?? []).includes(k)
                ? "child"
                : "sibling",
      };
    }
    return best;
  };

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
          name: fullName(q, loc, rulerId),
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
      if (id === subjectId || id === playerId) continue;
      const cProv = (
        (c["alive_data"] as Record<string, unknown> | undefined)?.["location"] as
          | Record<string, unknown>
          | undefined
      )?.["location"];
      const distance =
        myProvince !== undefined && typeof cProv === "number"
          ? loc.distance(myProvince, cProv)
          : null;
      if (distance !== null && distance > (opts.maxDistance ?? DEFAULT_RANGE)) continue;
      if (opts.regions?.length) {
        const p = (c["alive_data"] as Record<string, unknown> | undefined)?.["location"] as
          | Record<string, unknown>
          | undefined;
        const r =
          typeof p?.["location"] === "number" ? loc.provinceRegion(p["location"]) : undefined;
        if (
          !r ||
          !(opts.regions.includes(r.empire ?? "") || opts.regions.includes(r.kingdom ?? ""))
        )
          continue;
      }
      const female = c["female"] === true || c["female"] === "yes";
      if (female === myFemale) continue;
      const b = c["birth"];
      if (!(b instanceof Date)) continue;
      const age = nowYear - b.getUTCFullYear();
      if (age < MIN_AGE || age > MAX_AGE) continue;
      const fam = c["family_data"] as Record<string, unknown> | undefined;
      // The game's marriage list drops anyone who can't take another spouse (allowed_more_spouses):
      // married, or already betrothed (family_data.betrothed).
      if (
        fam &&
        (fam["spouse"] !== undefined ||
          fam["primary_spouse"] !== undefined ||
          fam["betrothed"] !== undefined)
      )
        continue;
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
      if (opts.minHomeStrength !== undefined && (realm?.strength ?? 0) < opts.minHomeStrength)
        continue;
      const keys = traitIdx.map((i) => loc.traitKey(i) ?? "");
      const goodGenes = traitIdx
        .filter((_, i) => GOOD_GENES.test(keys[i]!))
        .map((i) => loc.resolveTrait(i));
      const badGenes = traitIdx
        .filter((_, i) => BAD_GENES.test(keys[i]!))
        .map((i) => loc.resolveTrait(i));
      const claimTitles = (
        ((c["alive_data"] as Record<string, unknown> | undefined)?.["claim"] as
          | Array<{ title?: number }>
          | undefined) ?? []
      )
        .map((cl) => cl?.title)
        .filter((t): t is number => typeof t === "number");
      const nearby = realm?.nearby ?? false;
      const sameCulture = me["culture"] !== undefined && c["culture"] === me["culture"];
      const score =
        (fertility ?? 0.5) * 10 +
        skills.stewardship +
        skills.diplomacy / 2 +
        Math.min(8, (realm?.strength ?? 0) / 400) +
        (nearby ? 10 : 0) +
        (sameCulture ? 4 : 0) +
        goodGenes.length * 2 -
        badGenes.length * 3 -
        Math.max(0, age - 35) * 0.5;

      const kinOfRuler = kinOf(id, homeId);
      const allyRuler = allyRulerOf(id, c);
      const allyStrength = allyRuler?.strength ?? 0;
      const tier =
        allyStrength >= 3000 ? 3 : allyStrength >= 1500 ? 2 : allyStrength >= 800 ? 1 : 0;
      const priorityScore =
        tier * 100 +
        ((fertility ?? 0.5) * 10 + (age <= 25 ? 3 : 0) - Math.max(0, age - 30)) * 3 +
        (skills.stewardship + skills.diplomacy) * 0.7 +
        (goodGenes.length - badGenes.length) * 3 +
        claimTitles.length;

      found.push({
        id,
        name: fullNameOf(q, loc, c, id),
        age,
        skills,
        traits: traitIdx.map((i) => loc.resolveTrait(i)),
        goodGenes,
        badGenes,
        claims: claimTitles.slice(0, 4).map((t) => resolveTitleName(q, loc, t)),
        fertility,
        home: realm
          ? { id: realm.id, name: realm.name, realm: realm.realm, strength: realm.strength }
          : null,
        nearby,
        sameCulture,
        kinOfRuler,
        allyRuler,
        distance,
        inYourCourt: employer === playerId,
        score,
        priorityScore,
      });
    }
  }

  // Local (same region or culture) first: skills alone would send a Munster king to Germany.
  const local = (c: MarriageCandidate) => Number(c.nearby || c.sameCulture);
  if (opts.rank === "priority") found.sort((a, b) => b.priorityScore - a.priorityScore);
  else found.sort((a, b) => local(b) - local(a) || b.score - a.score);
  return {
    you: {
      id: subjectId,
      name: fullNameOf(q, loc, me, subjectId),
      age: myAge,
    },
    faithMatched,
    candidates: found.slice(0, limit),
  };
}
