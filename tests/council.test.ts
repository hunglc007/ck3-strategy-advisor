import { expect, test } from "vitest";
import { suggestCouncil, type Courtier, type CouncilInfo } from "../src/extract/council.js";

function c(
  id: number,
  age: number,
  dip: number,
  mar: number,
  ste: number,
  int: number,
  lea: number,
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
    knight: false,
    seat: null,
  };
}

test("suggests the best one-person-per-seat assignment and skips minors", () => {
  const courtiers = [
    c(1, 30, 12, 0, 0, 0, 0),
    c(2, 30, 0, 12, 0, 0, 0),
    c(3, 30, 0, 0, 12, 0, 0),
    c(4, 30, 0, 0, 0, 12, 0),
    c(5, 30, 0, 0, 0, 0, 12),
    c(6, 8, 20, 20, 20, 20, 20),
  ];
  const info: CouncilInfo = {
    courtiers,
    seats: { chancellor: 2, steward: 1, marshal: 3, spymaster: 4, court_chaplain: 5 },
  };
  const plan = suggestCouncil(info);
  const by = Object.fromEntries(plan.map((a) => [a.role, a.suggested?.id]));
  expect(by).toEqual({ chancellor: 1, steward: 3, marshal: 2, spymaster: 4, court_chaplain: 5 });
  expect(plan.find((a) => a.role === "chancellor")!.gain).toBe(12);
});
