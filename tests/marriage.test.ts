import { expect, test } from "vitest";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GameLookup } from "../src/gameLookup.js";
import { Localizer } from "../src/localization.js";
import { queryGamestate } from "../src/parser.js";
import { extractMarriageCandidates } from "../src/extract/marriage.js";

// Subject 1 (M, 20) is the son of ruler 10 and heir of the player (10). Rite 1 allows everything
// except close family; rite 2 (the foreign courtiers) forbids cousins as well.
const GS = Buffer.from(`date=1066.9.15
traits_lookup={ "brave" "eunuch_x" }
played_character={ character=10 player=1 }
landed_titles={
landed_titles={
50={ key="k_ireland" holder=10 }
51={ key="c_vannes" holder=20 }
}
}
rites={
	database={
		1={
			data={ name="Insular" tag="insular" doctrines={ doctrine=doctrine_gender_male_dominated doctrine=doctrine_consanguinity_aunt_nephew_and_uncle_niece } }
		}
		2={
			data={ name="Roman" tag="roman" doctrines={ doctrine=doctrine_consanguinity_restricted } }
		}
	}
}
living={
10={
	first_name="Ruler" birth=1020.1.1 rite=1
	family_data={ child={ 1 3 } }
	alive_data={ languages={ "language_goidelic" } }
	landed_data={ domain={ 50 } succession={ 1 } }
}
1={
	first_name="Subject" birth=1046.1.1 rite=1 skill={ 5 5 5 5 5 5 }
	family_data={ }
	alive_data={ languages={ "language_goidelic" } }
	court_data={ employer=10 }
}
2={
	first_name="Courtier" birth=1044.1.1 female=yes rite=2 skill={ 5 5 8 5 5 5 } traits={ 0 }
	family_data={ }
	alive_data={ languages={ "language_goidelic" } fertility=0.5 }
	court_data={ employer=20 }
}
3={
	first_name="Sister" birth=1045.1.1 female=yes rite=1
	family_data={ }
	alive_data={ languages={ "language_goidelic" } }
	court_data={ employer=10 }
}
4={
	first_name="Wife" birth=1044.1.1 female=yes rite=1
	family_data={ spouse=9 }
	alive_data={ languages={ "language_goidelic" } }
	court_data={ employer=20 }
}
5={
	first_name="Pool" birth=1044.1.1 female=yes rite=1 skill={ 5 5 5 5 5 5 }
	family_data={ }
	alive_data={ languages={ "language_goidelic" } }
}
6={
	first_name="Faraway" birth=1044.1.1 female=yes rite=2 skill={ 5 5 5 5 5 5 }
	family_data={ }
	alive_data={ languages={ "language_greek" } }
	court_data={ employer=20 }
}
7={
	first_name="Child" birth=1055.1.1 female=yes rite=1
	family_data={ }
	alive_data={ languages={ "language_goidelic" } }
	court_data={ employer=20 }
}
8={
	first_name="Eunuchish" birth=1044.1.1 female=yes rite=1 traits={ 1 }
	family_data={ }
	alive_data={ languages={ "language_goidelic" } }
	court_data={ employer=20 }
}
11={
	first_name="Daughter" birth=1046.1.1 female=yes rite=1 skill={ 5 5 5 5 5 5 }
	family_data={ }
	alive_data={ languages={ "language_goidelic" } }
}
12={
	first_name="Betrothed" birth=1044.1.1 female=yes rite=1
	family_data={ betrothed=9 }
	alive_data={ languages={ "language_goidelic" } }
	court_data={ employer=20 }
}
20={
	first_name="Neighbour" birth=1025.1.1 rite=1
	family_data={ child={ 11 } }
	alive_data={ languages={ "language_goidelic" } }
	landed_data={ domain={ 51 } }
}
}
`);

function setup() {
  const root = mkdtempSync(join(tmpdir(), "ck3-marriage-"));
  mkdirSync(join(root, "common", "traits"), { recursive: true });
  mkdirSync(join(root, "localization", "english"), { recursive: true });
  writeFileSync(
    join(root, "common", "traits", "00_traits.txt"),
    "brave = {\n\tprowess = 2\n}\neunuch_x = {\n\tflag = can_not_marry\n}\n",
  );
  const loc = new Localizer(root);
  return { loc, lookup: new GameLookup(root, loc) };
}

test("lists the game's marriage candidates and explains who was filtered out", async () => {
  const { loc, lookup } = setup();
  const m = await queryGamestate(GS, (q) => extractMarriageCandidates(q, loc, lookup, { id: 1 }));
  expect(m).not.toBeNull();
  expect(m!.subject).toMatchObject({
    id: 1,
    name: "Subject",
    female: false,
    age: 20,
    rite: "Insular",
  });
  // Courtier (at a neighbour's court), Pool and the neighbour's Daughter qualify.
  expect(m!.candidates.map((c) => c.name).sort()).toEqual(["Courtier", "Daughter", "Pool"]);
  expect(m!.excluded).toMatchObject({
    "already married": 1,
    "betrothed to someone else": 1,
    "age outside range": 1,
    "trait forbids marriage": 1,
    "too closely related": 1,
    "no shared language": 1,
  });
});

test("candidates carry their court, standing and source", async () => {
  const { loc, lookup } = setup();
  const m = await queryGamestate(GS, (q) => extractMarriageCandidates(q, loc, lookup, { id: 1 }));
  const byName = Object.fromEntries(m!.candidates.map((c) => [c.name, c]));
  expect(byName.Courtier).toMatchObject({ source: "courtier", rite: "Roman" });
  expect(byName.Courtier!.host).toMatchObject({ id: 20, name: "Neighbour", tier: "county" });
  expect(byName.Courtier!.notes).toContain("other rite: Roman");
  expect(byName.Courtier!.skills.effective.stewardship).toBe(8);
  expect(byName.Courtier!.traits).toEqual(["brave"]);
  expect(byName.Daughter).toMatchObject({ source: "ruler's child" });
  expect(byName.Daughter!.host!.id).toBe(20);
  expect(byName.Pool).toMatchObject({ source: "pool", host: null });
  expect(byName.Pool!.notes[0]).toMatch(/invite/);
  // Same-rite candidates from a ruled court come first.
  expect(m!.candidates[0]!.name).toBe("Daughter");
});

test("a stricter faith blocks relatives the subject's own faith allows", async () => {
  const { loc, lookup } = setup();
  // Without game files only the doctrines in the save matter: Sister (rite 1) is close family and blocked,
  // while a rite-2 cousin would be blocked by rite 2 only. Exercise the filter with the sister's rite switched.
  const swapped = Buffer.from(
    GS.toString().replace(
      'first_name="Sister" birth=1045.1.1 female=yes rite=1',
      'first_name="Sister" birth=1045.1.1 female=yes rite=2',
    ),
  );
  const m = await queryGamestate(swapped, (q) =>
    extractMarriageCandidates(q, loc, lookup, { id: 1 }),
  );
  expect(m!.candidates.map((c) => c.name)).not.toContain("Sister");
  const open = await queryGamestate(GS, (q) =>
    extractMarriageCandidates(q, loc, lookup, { id: 1, sameLanguage: false }),
  );
  expect(open!.candidates.map((c) => c.name)).toContain("Faraway");
});

test("defaults to the player's heir and reports an unknown id", async () => {
  const { loc, lookup } = setup();
  const heir = await queryGamestate(GS, (q) => extractMarriageCandidates(q, loc, lookup));
  expect(heir!.subject.id).toBe(1);
  const none = await queryGamestate(GS, (q) =>
    extractMarriageCandidates(q, loc, lookup, { id: 999 }),
  );
  expect(none).toBeNull();
});
