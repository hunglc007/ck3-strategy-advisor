import type { Query } from "../parser.js";
import { characterRecord, charName, characterAge, idList, playerIdOf } from "./common.js";

export interface Relative {
  id: number;
  name: string;
  age: number | null;
  alive: boolean;
  female: boolean;
  relation: string;
}
export interface FamilyInfo {
  subject: { id: number; name: string; age: number | null };
  parents: Relative[];
  spouses: Relative[];
  formerSpouses: Relative[];
  betrothed: Relative[];
  children: Relative[];
  siblings: Relative[];
  /** Only for the player: the first heirs in line, labelled by kinship. */
  heirs: Relative[];
}

// The save stores only parent -> child links (family_data.child); invert them
// across living and dead characters to answer "who are X's parents".
export function buildParentIndex(q: Query): Map<number, number[]> {
  const index = new Map<number, number[]>();
  for (const section of ["living", "dead_unprunable"]) {
    const all = (q.at(`/${section}`) as Record<string, unknown> | undefined) ?? {};
    for (const [key, raw] of Object.entries(all)) {
      const rec = (Array.isArray(raw) ? raw[0] : raw) as Record<string, unknown> | undefined;
      if (!rec || typeof rec !== "object") continue;
      const fam = rec["family_data"] as Record<string, unknown> | undefined;
      for (const child of idList(fam?.["child"])) {
        const parents = index.get(child) ?? [];
        if (!parents.includes(Number(key))) parents.push(Number(key));
        index.set(child, parents);
      }
    }
  }
  return index;
}

export class Kin {
  constructor(
    private q: Query,
    private parentIndex: Map<number, number[]>,
  ) {}

  parents(id: number): number[] {
    return this.parentIndex.get(id) ?? [];
  }
  children(id: number): number[] {
    const fam = characterRecord(this.q, id)?.["family_data"] as Record<string, unknown> | undefined;
    return idList(fam?.["child"]);
  }
  siblings(id: number): number[] {
    const out = new Set<number>();
    for (const p of this.parents(id)) for (const c of this.children(p)) if (c !== id) out.add(c);
    return [...out];
  }
  spouses(id: number): number[] {
    const fam = characterRecord(this.q, id)?.["family_data"] as Record<string, unknown> | undefined;
    return idList(fam?.["spouse"]);
  }

  // Kinship of `other` as seen from `self`, covering the relations that matter
  // for succession; anything further is just "relative".
  relation(self: number, other: number): string {
    if (other === self) return "self";
    const children = this.children(self);
    if (children.includes(other)) return "child";
    if (children.some((c) => this.children(c).includes(other))) return "grandchild";
    if (this.spouses(self).includes(other)) return "spouse";
    const parents = this.parents(self);
    if (parents.includes(other)) return "parent";
    const siblings = this.siblings(self);
    if (siblings.includes(other)) {
      const shared = this.parents(other).filter((p) => parents.includes(p)).length;
      return shared >= 2 || parents.length < 2 ? "sibling" : "half-sibling";
    }
    if (siblings.some((s) => this.children(s).includes(other))) return "nephew/niece";
    if (siblings.some((s) => this.children(s).some((c) => this.children(c).includes(other))))
      return "grand-nephew/niece";
    const parentSiblings = parents.flatMap((p) => this.siblings(p));
    if (parentSiblings.includes(other)) return "uncle/aunt";
    if (parentSiblings.some((u) => this.children(u).includes(other))) return "first cousin";
    if (parents.some((p) => this.parents(p).includes(other))) return "grandparent";
    return "relative";
  }
}

// Gendered wording for the neutral kinship labels ("child" -> "son"/"daughter").
const GENDERED: Record<string, [string, string]> = {
  child: ["son", "daughter"],
  grandchild: ["grandson", "granddaughter"],
  parent: ["father", "mother"],
  grandparent: ["grandfather", "grandmother"],
  sibling: ["brother", "sister"],
  "half-sibling": ["half-brother", "half-sister"],
  "nephew/niece": ["nephew", "niece"],
  "grand-nephew/niece": ["grand-nephew", "grand-niece"],
  "uncle/aunt": ["uncle", "aunt"],
  spouse: ["husband", "wife"],
};

function relative(q: Query, id: number, relation: string): Relative {
  const living = q.at(`/living/${id}/first_name`) !== undefined;
  const female = characterRecord(q, id)?.["female"] === true;
  const gendered = GENDERED[relation];
  return {
    id,
    name: charName(q, id),
    age: living ? characterAge(q, id) : null,
    alive: living,
    female,
    relation: gendered ? gendered[female ? 1 : 0] : relation,
  };
}

export function extractFamily(q: Query, id?: number, heirCount = 10): FamilyInfo | null {
  const playerId = playerIdOf(q);
  const subjectId = id ?? playerId;
  const rec = characterRecord(q, subjectId);
  if (!rec) return null;
  const kin = new Kin(q, buildParentIndex(q));
  const fam = (rec["family_data"] as Record<string, unknown> | undefined) ?? {};
  const byAge = (a: Relative, b: Relative) => (b.age ?? -1) - (a.age ?? -1);

  const heirs: Relative[] = [];
  if (subjectId === playerId) {
    const line = (q.at(`/living/${playerId}/landed_data/succession`) as number[] | undefined) ?? [];
    for (const h of line.slice(0, heirCount)) heirs.push(relative(q, h, kin.relation(playerId, h)));
  }

  return {
    subject: { id: subjectId, name: charName(q, subjectId), age: characterAge(q, subjectId) },
    parents: kin.parents(subjectId).map((p) => relative(q, p, "parent")),
    spouses: idList(fam["spouse"]).map((s) => relative(q, s, "spouse")),
    formerSpouses: idList(fam["former_spouses"]).map((s) => relative(q, s, "former spouse")),
    betrothed: idList(fam["betrothed"]).map((s) => relative(q, s, "betrothed")),
    children: kin
      .children(subjectId)
      .map((c) => relative(q, c, "child"))
      .sort(byAge),
    siblings: kin
      .siblings(subjectId)
      .map((s) => relative(q, s, kin.relation(subjectId, s)))
      .sort(byAge),
    heirs,
  };
}
