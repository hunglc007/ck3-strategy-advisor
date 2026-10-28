import type { Query } from "../parser.js";
import type { Localizer } from "../localization.js";
import type { GameLookup } from "../gameLookup.js";
import { ageAt, characterAge, characterRecord, idList, num, playerIdOf } from "./common.js";
import { Kin, buildParentIndex } from "./family.js";
import { fullNameOf } from "./names.js";
import { effectiveSkills, type EffectiveSkills } from "./skills.js";
import { resolveTitleName, titleTierFromKey, type TitleTier } from "./titleUtils.js";

type Rec = Record<string, unknown>;

export interface MarriageOptions {
  /** Whose spouse to look for; defaults to the player's first heir. */
  id?: number;
  minAge?: number;
  maxAge?: number;
  /**
   * Keep only candidates who share a language with the subject. Off by default: the game lists
   * people by diplomatic range, not by language.
   */
  sameLanguage?: boolean;
  /**
   * Only people within this map distance of the player. The game only lists rulers in diplomatic
   * range (capped at 1000 game units); the default reproduces the ~480 candidates a Munster ruler
   * sees. Pass a large number for the whole world.
   */
  maxDistance?: number;
  /** "standing" (default): court tier and rite first. "priority": ally strength, then youth and fertility, skills, genes. */
  rank?: "standing" | "priority";
  /** Keep only candidates whose court/parent matches this name (substring, case-insensitive). */
  host?: string;
  limit?: number;
}

export interface MarriageCandidate {
  id: number;
  name: string;
  age: number | null;
  female: boolean;
  /** How the candidate is reachable in the game's marriage list. */
  source: "ruler" | "courtier" | "ruler's child" | "pool";
  /** Ruler whose list they appear in (the ruler's own id for a ruler). */
  host: { id: number; name: string; title: string | null; tier: TitleTier | null } | null;
  /** The candidate's own title if they rule. */
  ownTitle: string | null;
  rite: string | null;
  /** Kinship to the subject when there is one allowed by both rites. */
  kinship: string | null;
  skills: EffectiveSkills;
  traits: string[];
  fertility: number | null;
  /** Heritable good and bad traits (genetic quality of future children). */
  goodGenes: string[];
  badGenes: string[];
  /** Titles they hold a claim on (up to 4). */
  claims: string[];
  /**
   * Strongest ruler among the candidate's close family (parents, siblings, children) or the
   * candidate: the game lets a marriage unlock an alliance with such a ruler.
   */
  allyRuler: { id: number; name: string; strength: number; relation: string } | null;
  /** Map distance from the player's location, when known. */
  distance: number | null;
  notes: string[];
}

export interface MarriageInfo {
  subject: { id: number; name: string; age: number | null; female: boolean; rite: string | null };
  candidates: MarriageCandidate[];
  total: number;
  scanned: number;
  excluded: Record<string, number>;
}

const TIER_WEIGHT: Record<TitleTier, number> = {
  empire: 5,
  kingdom: 4,
  duchy: 3,
  county: 2,
  barony: 1,
  other: 0,
};

/** The game only lists rulers in diplomatic range (max 1000 game units); 1130 map units reproduces the ~480 candidates seen around Munster. */
const DEFAULT_RANGE = 1130;
const GOOD_GENES = /^((beauty|intellect|physique)_good_\d|fecund|pure_blooded)$/;
const BAD_GENES =
  /^((beauty|intellect|physique)_bad_\d|inbred|bleeder|clubfooted|hunchbacked|lisping|stuttering|weak|dull|spindly|scaly|albino|wheezing|infertile)$/;

// Consanguinity doctrines of a rite; the game blocks a marriage when either side's rite forbids
// the relation (unless one is the other's courtier).
const CLOSE = new Set(["child", "grandchild", "parent", "grandparent", "sibling", "half-sibling"]);
const UNCLE_NIBLING = new Set(["uncle/aunt", "nephew/niece"]);

function forbiddenBy(doctrines: string[], kinship: string, sameDynasty: boolean): boolean {
  const has = (d: string) => doctrines.includes(`doctrine_consanguinity_${d}`);
  if (has("unrestricted")) return false;
  if (has("dynastic") && sameDynasty) return true;
  if (has("restricted"))
    return CLOSE.has(kinship) || UNCLE_NIBLING.has(kinship) || kinship === "first cousin";
  if (has("cousins")) return CLOSE.has(kinship) || UNCLE_NIBLING.has(kinship);
  if (has("aunt_nephew_and_uncle_niece")) return CLOSE.has(kinship);
  return false;
}

// Every `doctrine = x` line under a rite record, wherever it sits in the structure.
function collectDoctrines(node: unknown, out: string[] = []): string[] {
  if (Array.isArray(node)) {
    for (const n of node) collectDoctrines(n, out);
  } else if (node && typeof node === "object") {
    for (const [k, v] of Object.entries(node as Rec)) {
      if (k === "doctrine") {
        for (const d of Array.isArray(v) ? v : [v]) if (typeof d === "string") out.push(d);
      } else {
        collectDoctrines(v, out);
      }
    }
  }
  return out;
}

class Rites {
  private cache = new Map<number, { name: string; doctrines: string[] }>();
  constructor(private q: Query) {}
  get(id: number | null): { name: string; doctrines: string[] } | null {
    if (id === null) return null;
    let r = this.cache.get(id);
    if (!r) {
      const rec = this.q.at(`/rites/database/${id}`) as Rec | undefined;
      const data = (rec?.["data"] as Rec | undefined) ?? {};
      const name =
        (typeof data["name"] === "string" && data["name"]) ||
        (typeof data["tag"] === "string" && data["tag"]) ||
        `rite ${id}`;
      r = { name, doctrines: collectDoctrines(rec) };
      this.cache.set(id, r);
    }
    return r;
  }
}

/**
 * Re-creates the game's "arrange marriage" lists. For one ruler the game lists the ruler, their
 * courtiers (present or away) and their children, then keeps those who satisfy
 * `can_marry_character_trigger` against the subject. Taking the union over every ruler gives all
 * characters with a court, every ruler, and every ruler's child. Unattached "pool" characters are
 * not in any list but can be invited to court first, so they are included and marked.
 *
 * Not simulated: the acceptance chance (opinion, alliances), clergy and trait rules, and doctrines
 * that allow several spouses.
 */
export function extractMarriageCandidates(
  q: Query,
  loc: Localizer,
  lookup: GameLookup | null = null,
  opts: MarriageOptions = {},
): MarriageInfo | null {
  const playerId = playerIdOf(q);
  const heir = idList(q.at(`/living/${playerId}/landed_data/succession`))[0];
  const subjectId = opts.id ?? heir ?? playerId;
  const subjectRec = characterRecord(q, subjectId);
  if (!subjectRec || q.at(`/living/${subjectId}/first_name`) === undefined) return null;
  loc.setTraitLookup((q.at("/traits_lookup") as string[] | null | undefined) ?? null);

  const date = q.at("/date");
  const minAge = opts.minAge ?? 16;
  const maxAge = opts.maxAge ?? 45;
  const limit = opts.limit ?? 25;
  const subjectFemale = subjectRec["female"] === true;
  const subjectAge = characterAge(q, subjectId);
  const rites = new Rites(q);
  const subjectRiteId = num(subjectRec["rite"]);
  const subjectRite = rites.get(subjectRiteId);
  const subjectLangs = new Set(
    ((subjectRec["alive_data"] as Rec | undefined)?.["languages"] as string[] | undefined) ?? [],
  );
  const subjectEmployer = num((subjectRec["court_data"] as Rec | undefined)?.["employer"]);
  const subjectFam = (subjectRec["family_data"] as Rec | undefined) ?? {};
  const subjectBetrothed = idList(subjectFam["betrothed"]);

  const houseDynasty = (house: unknown): number | null =>
    typeof house === "number" ? num(q.at(`/dynasties/dynasty_house/${house}/dynasty`)) : null;
  const subjectDynasty = houseDynasty(subjectRec["dynasty_house"]);

  const kin = new Kin(q, buildParentIndex(q));
  const playerRec = characterRecord(q, playerId);
  const playerProvince = num(
    ((playerRec?.["alive_data"] as Rec | undefined)?.["location"] as Rec | undefined)?.["location"],
  );
  const maxDistance = opts.maxDistance ?? DEFAULT_RANGE;
  const all = (q.at("/living") as Record<string, unknown> | undefined) ?? {};
  const rec = (id: number): Rec | null => {
    const raw = all[String(id)];
    const r = Array.isArray(raw) ? raw[0] : raw;
    return r && typeof r === "object" ? (r as Rec) : null;
  };
  // A parent known to rule (landed) gets the child listed in their marriage list.
  const isRuler = (r: Rec | null): boolean =>
    !!r && idList((r["landed_data"] as Rec | undefined)?.["domain"]).length > 0;
  const topTitle = (r: Rec | null): { name: string; tier: TitleTier } | null => {
    const first = r ? idList((r["landed_data"] as Rec | undefined)?.["domain"])[0] : undefined;
    if (first === undefined) return null;
    const key = q.at(`/landed_titles/landed_titles/${first}/key`);
    return {
      name: resolveTitleName(q, loc, first),
      tier: typeof key === "string" ? titleTierFromKey(key) : "other",
    };
  };

  // Relatives the consanguinity rules can care about; everyone else skips the kinship walk.
  const relatives = new Set<number>();
  const addAll = (ids: number[]) => ids.forEach((x) => relatives.add(x));
  const parentIds = kin.parents(subjectId);
  addAll(parentIds);
  for (const p of parentIds) {
    addAll(kin.parents(p));
    const uncles = kin.siblings(p);
    addAll(uncles);
    for (const u of uncles) addAll(kin.children(u));
  }
  const siblingIds = kin.siblings(subjectId);
  addAll(siblingIds);
  for (const sib of siblingIds) {
    const nibs = kin.children(sib);
    addAll(nibs);
    for (const n of nibs) addAll(kin.children(n));
  }
  const childIds = kin.children(subjectId);
  addAll(childIds);
  for (const ch of childIds) addAll(kin.children(ch));

  const dynasticRules = (a: { doctrines: string[] } | null, b: { doctrines: string[] } | null) =>
    [a, b].some((r) => r?.doctrines.includes("doctrine_consanguinity_dynastic"));
  const titleCache = new Map<number, ReturnType<typeof topTitle>>();
  const cachedTitle = (id: number, r: Rec | null) => {
    if (!titleCache.has(id)) titleCache.set(id, topTitle(r));
    return titleCache.get(id) ?? null;
  };

  // Traits carrying the `can_not_marry` flag (eunuchs, the devoted, order members) block marriage.
  const blockingTrait = new Map<number, boolean>();
  const cannotMarry = (c: Rec): boolean =>
    idList(c["traits"]).some((idx) => {
      let blocked = blockingTrait.get(idx);
      if (blocked === undefined) {
        const key = loc.traitIdentifier(idx);
        blocked = !!key && !!lookup?.get("trait", key)?.text.includes("can_not_marry");
        blockingTrait.set(idx, blocked);
      }
      return blocked;
    });

  const excluded: Record<string, number> = {};
  const skip = (why: string) => {
    excluded[why] = (excluded[why] ?? 0) + 1;
  };
  type Prelim = Omit<
    MarriageCandidate,
    "skills" | "traits" | "goodGenes" | "badGenes" | "claims" | "allyRuler"
  >;
  const found: Prelim[] = [];
  const hostFilter = opts.host?.toLowerCase().replace(/_/g, "");
  let scanned = 0;

  for (const [key, raw] of Object.entries(all)) {
    const r = Array.isArray(raw) ? raw[0] : raw;
    if (!r || typeof r !== "object") continue;
    const c = r as Rec;
    const id = Number(key);
    if (id === subjectId) continue;
    scanned++;
    if ((c["female"] === true) === subjectFemale) {
      skip("same sex");
      continue;
    }
    const age = ageAt(c["birth"], date);
    if (age === null || age < minAge || age > maxAge) {
      skip("age outside range");
      continue;
    }
    const fam = (c["family_data"] as Rec | undefined) ?? {};
    const betrothed = idList(fam["betrothed"]);
    if (idList(fam["spouse"]).length > 0) {
      skip("already married");
      continue;
    }
    if (betrothed.length > 0 && !betrothed.includes(subjectId)) {
      skip("betrothed to someone else");
      continue;
    }
    if (subjectBetrothed.length > 0 && !subjectBetrothed.includes(id)) {
      skip("subject is betrothed to someone else");
      continue;
    }

    if (cannotMarry(c)) {
      skip("trait forbids marriage");
      continue;
    }
    const alive = (c["alive_data"] as Rec | undefined) ?? {};
    // Diplomatic range: the game lists only people near the player's court.
    const candProvince = num((alive["location"] as Rec | undefined)?.["location"]);
    const distance =
      playerProvince !== null && candProvince !== null
        ? loc.distance(playerProvince, candProvince)
        : null;
    if (distance !== null && distance > maxDistance) {
      skip("out of diplomatic range");
      continue;
    }
    if (opts.sameLanguage === true && subjectLangs.size > 0) {
      const langs = (alive["languages"] as string[] | undefined) ?? [];
      if (!langs.some((l) => subjectLangs.has(l))) {
        skip("no shared language");
        continue;
      }
    }

    // Where would the game list them?
    const employer = num((c["court_data"] as Rec | undefined)?.["employer"]);
    const parents = kin.parents(id);
    const rulerParent = parents.find((p) => isRuler(rec(p)));
    let source: MarriageCandidate["source"];
    let hostId: number | null;
    if (isRuler(c)) {
      source = "ruler";
      hostId = id;
    } else if (employer !== null) {
      source = "courtier";
      hostId = employer;
    } else if (rulerParent !== undefined) {
      source = "ruler's child";
      hostId = rulerParent;
    } else {
      source = "pool";
      hostId = null;
    }

    // Consanguinity under each side's rite, unless one is the other's courtier.
    const kinship = relatives.has(id) ? kin.relation(subjectId, id) : "relative";
    const rel = kinship === "relative" ? "" : kinship;
    const riteId = num(c["rite"]);
    const rite = rites.get(riteId);
    const sameDynasty =
      dynasticRules(subjectRite, rite) &&
      subjectDynasty !== null &&
      houseDynasty(c["dynasty_house"]) === subjectDynasty;
    const courtierOfEither = employer === subjectId || subjectEmployer === id;
    if (rel && !courtierOfEither) {
      const blocked =
        (subjectRite && forbiddenBy(subjectRite.doctrines, rel, sameDynasty)) ||
        (rite && forbiddenBy(rite.doctrines, rel, sameDynasty));
      if (blocked) {
        skip("too closely related");
        continue;
      }
    }

    const hostRec = hostId !== null ? rec(hostId) : null;
    if (hostFilter) {
      const names = [hostRec?.["first_name"], c["first_name"]]
        .filter((n): n is string => typeof n === "string")
        .map((n) => n.toLowerCase().replace(/_/g, ""));
      if (!names.some((n) => n.includes(hostFilter))) {
        skip("host filter");
        continue;
      }
    }
    const hostTitle = hostId !== null ? cachedTitle(hostId, hostRec) : null;
    const ownTitle = source === "ruler" ? hostTitle : null;

    const notes: string[] = [];
    if (source === "pool") notes.push("unattached: invite to your court first");
    if (betrothed.includes(subjectId)) notes.push("already betrothed to the subject");
    if (rel) notes.push(`related: ${rel}`);
    if (sameDynasty) notes.push("same dynasty");
    if (riteId !== null && subjectRiteId !== null && riteId !== subjectRiteId && rite)
      notes.push(`other rite: ${rite.name}`);
    if (source === "courtier" && hostId === subjectEmployer) notes.push("already at your court");

    found.push({
      id,
      name: fullNameOf(q, loc, c, id),
      age,
      female: c["female"] === true,
      source,
      host:
        hostId !== null
          ? {
              id: hostId,
              name: fullNameOf(q, loc, hostRec ?? undefined, hostId),
              title: hostTitle?.name ?? null,
              tier: hostTitle?.tier ?? null,
            }
          : null,
      ownTitle: ownTitle?.name ?? null,
      rite: rite?.name ?? null,
      kinship: rel || null,
      fertility: num(alive["fertility"]),
      distance,
      notes,
    });
  }

  const subjectRiteName = subjectRite?.name ?? null;
  // Standing of the connection first (court tier, same rite); skills only break ties.
  const standing = (m: Prelim) =>
    (m.host?.tier ? TIER_WEIGHT[m.host.tier] : 0) * 100 +
    (m.rite !== null && m.rite === subjectRiteName ? 50 : 0);
  found.sort((a, b) => standing(b) - standing(a));

  // The game's alliance rule: the spouse is a ruler or has a ruler among close family.
  const strengthOf = (id: number): number | null =>
    num((characterRecord(q, id)?.["landed_data"] as Rec | undefined)?.["strength"]);
  const allyRulerOf = (id: number): MarriageCandidate["allyRuler"] => {
    const family: Array<[number, string]> = [[id, "self"]];
    for (const p of kin.parents(id)) family.push([p, "parent"]);
    for (const s2 of kin.siblings(id)) family.push([s2, "sibling"]);
    for (const ch of kin.children(id)) family.push([ch, "child"]);
    let best: MarriageCandidate["allyRuler"] = null;
    for (const [fid, relation] of family) {
      const st = strengthOf(fid);
      if (st === null || (best !== null && st <= best.strength)) continue;
      best = {
        id: fid,
        name: fullNameOf(q, loc, characterRecord(q, fid) ?? undefined, fid),
        strength: st,
        relation,
      };
    }
    return best;
  };

  // Skills, traits and family cost a lookup each, so only the best-standing candidates get them.
  const shortlist = found.slice(0, Math.max(limit * 4, 80)).map((m): MarriageCandidate => {
    const traitIdx = (q.at(`/living/${m.id}/traits`) as number[] | undefined) ?? [];
    const keys = traitIdx.map((t) => loc.traitIdentifier(t) ?? "");
    const claimTitles = (
      ((characterRecord(q, m.id)?.["alive_data"] as Rec | undefined)?.["claim"] as
        | Array<{ title?: number }>
        | undefined) ?? []
    )
      .map((cl) => cl?.title)
      .filter((t): t is number => typeof t === "number");
    return {
      ...m,
      skills: effectiveSkills(q, loc, lookup, m.id),
      traits: traitIdx.map((t) => loc.resolveTrait(t)),
      goodGenes: traitIdx
        .filter((_, i) => GOOD_GENES.test(keys[i]!))
        .map((t) => loc.resolveTrait(t)),
      badGenes: traitIdx.filter((_, i) => BAD_GENES.test(keys[i]!)).map((t) => loc.resolveTrait(t)),
      claims: claimTitles.slice(0, 4).map((t) => resolveTitleName(q, loc, t)),
      allyRuler: allyRulerOf(m.id),
    };
  });
  const score = (m: MarriageCandidate) => {
    const s = m.skills.effective;
    return standing(m) + s.diplomacy + s.stewardship + s.intrigue + s.learning;
  };
  // Priority order for an heir: a strong ally first, then youth and fertility, skills, good genes.
  const priority = (m: MarriageCandidate) => {
    const ally = m.allyRuler?.strength ?? 0;
    const tier = ally >= 3000 ? 3 : ally >= 1500 ? 2 : ally >= 800 ? 1 : 0;
    const age = m.age ?? 30;
    const s = m.skills.effective;
    return (
      tier * 100 +
      ((m.fertility ?? 0.5) * 10 + (age <= 25 ? 3 : 0) - Math.max(0, age - 30)) * 3 +
      (s.stewardship + s.diplomacy) * 0.7 +
      (m.goodGenes.length - m.badGenes.length) * 3 +
      m.claims.length
    );
  };
  shortlist.sort((a, b) =>
    opts.rank === "priority" ? priority(b) - priority(a) : score(b) - score(a),
  );

  return {
    subject: {
      id: subjectId,
      name: fullNameOf(q, loc, subjectRec, subjectId),
      age: subjectAge,
      female: subjectFemale,
      rite: subjectRiteName,
    },
    candidates: shortlist.slice(0, limit),
    total: found.length,
    scanned,
    excluded,
  };
}
