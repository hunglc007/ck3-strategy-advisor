import { expect, test } from "vitest";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GameLookup, parseTraitSkills } from "../src/gameLookup.js";
import { Localizer } from "../src/localization.js";
import { queryGamestate } from "../src/parser.js";
import { effectiveSkills, formatEffective } from "../src/extract/skills.js";

const TRAITS = `
eccentric = {
	category = personality
	learning = 2
	diplomacy = -2 # comment { with a brace
	same_opinion = 10
	culture_modifier = {
		parameter = x
		learning = 99
	}
}
lifestyle_reveler = {
	category = lifestyle
	intrigue = 1
	track = {
		50 = {
			diplomacy = 1
			intrigue = 1
		}
		100 = {
			diplomacy = 2
			intrigue = 1
		}
	}
}
lifestyle_poet = {
	diplomacy_per_prestige_level = 1
	track = {
		50 = { diplomacy = 1 courtly_opinion = 5 }
	}
}
named_value_trait = {
	stewardship = medium_skill_bonus
}
brave = {
	prowess = 2
}
`;

test("parseTraitSkills reads direct modifiers and track tiers, not nested ones", () => {
  const eccentric = parseTraitSkills(
    TRAITS.slice(TRAITS.indexOf("eccentric"), TRAITS.indexOf("lifestyle_reveler")),
  );
  expect(eccentric.fixed).toEqual({ learning: 2, diplomacy: -2 }); // learning = 99 is in a nested block
  expect(eccentric.tracks).toEqual([]);

  const reveler = parseTraitSkills(
    TRAITS.slice(TRAITS.indexOf("lifestyle_reveler"), TRAITS.indexOf("lifestyle_poet")),
  );
  expect(reveler.fixed).toEqual({ intrigue: 1 });
  expect(reveler.tracks).toEqual([
    { threshold: 50, bonus: { diplomacy: 1, intrigue: 1 } },
    { threshold: 100, bonus: { diplomacy: 2, intrigue: 1 } },
  ]);

  const poet = parseTraitSkills(
    TRAITS.slice(TRAITS.indexOf("lifestyle_poet"), TRAITS.indexOf("named_value_trait")),
  );
  expect(poet.fixed).toEqual({});
  expect(poet.tracks).toEqual([{ threshold: 50, bonus: { diplomacy: 1 } }]);

  const named = parseTraitSkills(
    TRAITS.slice(TRAITS.indexOf("named_value_trait"), TRAITS.indexOf("brave")),
  );
  expect(named.unresolved).toBe(true);
});

function setup() {
  const root = mkdtempSync(join(tmpdir(), "ck3-skills-"));
  mkdirSync(join(root, "common", "traits"), { recursive: true });
  mkdirSync(join(root, "localization", "english"), { recursive: true });
  writeFileSync(join(root, "common", "traits", "00_traits.txt"), TRAITS);
  const loc = new Localizer(root);
  return { loc, lookup: new GameLookup(root, loc) };
}

// traits 0..4 = eccentric, lifestyle_reveler, lifestyle_poet, brave, mystery_trait
const GS = (extra: string) =>
  Buffer.from(`date=1066.9.15
traits_lookup={ "eccentric" "lifestyle_reveler" "lifestyle_poet" "brave" "mystery_trait" }
living={
1={ skill={ 6 4 5 10 10 3 } traits={ 0 1 2 3 } trait_xp_amounts={ 60 0 } ${extra} }
2={ skill={ 5 5 5 5 5 5 } traits={ 3 } }
3={ skill={ 5 5 5 5 5 5 } traits={ 1 2 4 } trait_xp_amounts={ 0 0 } }
4={ skill={ 5 5 5 5 5 5 } traits={ 1 2 } trait_xp_amounts={ 0 } }
}
`);

test("effectiveSkills adds fixed trait bonuses and the XP tiers the character reached", async () => {
  const { loc, lookup } = setup();
  loc.setTraitLookup([
    "eccentric",
    "lifestyle_reveler",
    "lifestyle_poet",
    "brave",
    "mystery_trait",
  ]);
  const r = await queryGamestate(GS(""), (q) => effectiveSkills(q, loc, lookup, 1));
  expect(r.base).toMatchObject({ diplomacy: 6, intrigue: 10, learning: 10 });
  // eccentric: Lrn +2, Dip -2; reveler: Int +1 and (60 xp >= 50) Dip +1 Int +1; poet at 0 xp: nothing; brave: Prw +2
  expect(r.bonus).toEqual({
    diplomacy: -1,
    martial: 0,
    stewardship: 0,
    intrigue: 2,
    learning: 2,
    prowess: 2,
  });
  expect(r.effective).toMatchObject({ diplomacy: 5, intrigue: 12, learning: 12, prowess: 5 });
  expect(r.incomplete).toBe(false);
  expect(formatEffective(r)).toBe(
    "Dip 5 (6) | Mar 4 | Stw 5 | Int 12 (10) | Lrn 12 (10) | Prw 5 (3)",
  );
});

test("effectiveSkills flags unknown traits and mismatched XP lists instead of guessing", async () => {
  const { loc, lookup } = setup();
  loc.setTraitLookup([
    "eccentric",
    "lifestyle_reveler",
    "lifestyle_poet",
    "brave",
    "mystery_trait",
  ]);
  const unknown = await queryGamestate(GS(""), (q) => effectiveSkills(q, loc, lookup, 3));
  expect(unknown.incomplete).toBe(true); // mystery_trait isn't in the game files
  const mismatch = await queryGamestate(GS(""), (q) => effectiveSkills(q, loc, lookup, 4));
  expect(mismatch.incomplete).toBe(true); // 2 tracked traits but 1 XP entry
  expect(mismatch.bonus.intrigue).toBe(1); // only the fixed part is counted
});

test("without game files the base skills are returned unchanged", async () => {
  const loc = new Localizer(null);
  loc.setTraitLookup(["eccentric"]);
  const none = new GameLookup(null, loc);
  const r = await queryGamestate(GS(""), (q) => effectiveSkills(q, loc, none, 2));
  expect(r.effective).toEqual(r.base);
  expect(r.incomplete).toBe(false);
});
