import { expect, test } from "vitest";
import { parseTraitSkills } from "../src/traitSkills.js";
import { effectiveSkills } from "../src/extract/skills.js";
import { Localizer } from "../src/localization.js";

const TRAITS = `
# comment
lifestyle_reveler = {
	category = lifestyle
	courtly_opinion = 5
	intrigue = 1
	culture_modifier = { parameter = x  diplomacy = 9 }
	track = {
		50 = { diplomacy = 1 intrigue = 1 }
		100 = { diplomacy = 2 intrigue = 2 }
	}
}
education_diplomacy_3 = { diplomacy = 6 }
brave = { prowess = 2 martial = -1 }
`;

test("parses flat and tracked trait skill modifiers, ignoring nested culture modifiers", () => {
  const m = parseTraitSkills(TRAITS);
  expect(m.get("lifestyle_reveler")!.base).toEqual({ intrigue: 1 });
  expect(m.get("lifestyle_reveler")!.tracks[0]!.map((l) => l.xp)).toEqual([50, 100]);
  expect(m.get("education_diplomacy_3")!.base).toEqual({ diplomacy: 6 });
});

test("effectiveSkills adds trait modifiers to the stored base skills", () => {
  const loc = new Localizer(null);
  loc.setTraitLookup(["lifestyle_reveler", "brave"]);
  const parsed = parseTraitSkills(TRAITS);
  (loc as unknown as { traitSkills: typeof parsed }).traitSkills = parsed;
  // base: dip 6, mar 4, ste 5, int 10, lea 10, prw 3; reveler xp 0 -> only flat +1 intrigue
  const r = effectiveSkills(loc, [6, 4, 5, 10, 10, 3], [0, 1], [0]);
  expect(r.total).toEqual({
    diplomacy: 6,
    martial: 3,
    stewardship: 5,
    intrigue: 11,
    learning: 10,
    prowess: 5,
  });
  // reaching the first XP threshold adds that level's modifiers on top
  expect(effectiveSkills(loc, [6, 4, 5, 10, 10, 3], [0], [50]).total.diplomacy).toBe(7);
});
