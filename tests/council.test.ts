import { expect, test } from "vitest";
import {
  riskNotes,
  suggestCouncil,
  type Courtier,
  type CouncilInfo,
} from "../src/extract/council.js";

function c(
  id: number,
  age: number,
  dip: number,
  mar: number,
  ste: number,
  int: number,
  lea: number,
  extra: Partial<Courtier> = {},
): Courtier {
  return {
    id,
    name: `c${id}`,
    age,
    skills: {
      diplomacy: dip,
      martial: mar,
      stewardship: ste,
      intrigue: int,
      learning: lea,
      prowess: 0,
    },
    traits: [],
    traitKeys: [],
    knight: false,
    seat: null,
    vassal: false,
    sameHouse: false,
    health: 4,
    opinion: null,
    claim: null,
    inFaction: false,
    ...extra,
  };
}

const seats = { chancellor: 2, steward: 1, marshal: 3, spymaster: 4, court_chaplain: 5 };

test("suggests the best one-person-per-seat assignment and skips minors", () => {
  const courtiers = [
    c(1, 30, 12, 0, 0, 0, 0),
    c(2, 30, 0, 12, 0, 0, 0),
    c(3, 30, 0, 0, 12, 0, 0),
    c(4, 30, 0, 0, 0, 12, 0),
    c(5, 30, 0, 0, 0, 0, 12),
    c(6, 8, 20, 20, 20, 20, 20),
  ];
  const plan = suggestCouncil({ courtiers, seats });
  const by = Object.fromEntries(plan.map((a) => [a.role, a.suggested?.id]));
  expect(by).toEqual({ chancellor: 1, steward: 3, marshal: 2, spymaster: 4, court_chaplain: 5 });
  expect(plan.find((a) => a.role === "chancellor")!.gain).toBe(12);
});

test("an old, frail pick loses to a slightly weaker healthy one", () => {
  const courtiers = [
    c(1, 77, 0, 0, 0, 14, 0, { health: 2.5 }),
    c(2, 30, 0, 0, 0, 11, 0),
    ...[2, 3, 1, 5].map((id) => c(100 + id, 30, 0, 0, 0, 0, 0)),
  ];
  const plan = suggestCouncil({ courtiers, seats: { ...seats, spymaster: null } });
  expect(plan.find((a) => a.role === "spymaster")!.suggested!.id).toBe(2);
});

test("pressed claimants on your titles and faction members are never suggested", () => {
  const courtiers = [
    c(1, 30, 0, 0, 0, 15, 0, { claim: "pressed" }),
    c(2, 30, 0, 0, 0, 14, 0, { inFaction: true }),
    c(3, 30, 0, 0, 0, 5, 0),
  ];
  const info: CouncilInfo = { courtiers, seats: { ...seats, spymaster: null } };
  expect(suggestCouncil(info).find((a) => a.role === "spymaster")!.suggested!.id).toBe(3);
  expect(riskNotes(courtiers[0]!)).toContain("has a pressed claim on your titles");
});

test("an unpressed family claim only costs a point, it does not disqualify", () => {
  const info: CouncilInfo = {
    courtiers: [c(1, 30, 0, 0, 0, 12, 0, { claim: "unpressed" }), c(2, 30, 0, 0, 0, 5, 0)],
    seats: { ...seats, spymaster: null },
  };
  expect(suggestCouncil(info).find((a) => a.role === "spymaster")!.suggested!.id).toBe(1);
});
