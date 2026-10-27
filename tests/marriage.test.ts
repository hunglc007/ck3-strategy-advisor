import { expect, test } from "vitest";
import { queryGamestate } from "../src/parser.js";
import { Localizer } from "../src/localization.js";
import { extractMarriageCandidates } from "../src/extract/marriage.js";

const GS = Buffer.from(`
traits_lookup={ "just" }
played_character={ character=1 player=1 }
rites={ database={ 1={ faith=13 } 2={ faith=13 } 3={ faith=9 } } }
landed_titles={ landed_titles={
10={ key="k_ireland" name="Ireland" de_jure_vassals={ 11 } }
11={ key="d_munster" name="Munster" holder=1 de_jure_liege=10 }
12={ key="k_france" name="France" holder=9 }
} }
living={
1={ first_name="Murchad" birth=1027.1.1 culture=75 rite=1 dynasty_house=100 skill={ 10 12 6 3 3 12 } landed_data={ domain={ 11 } strength=800 } }
2={ first_name="Aoife" birth=1042.1.1 female=yes culture=75 rite=2 skill={ 5 5 8 5 5 5 } traits={ 0 } alive_data={ fertility=0.6 } }
3={ first_name="Married" birth=1042.1.1 female=yes culture=75 rite=1 family_data={ spouse=99 } }
4={ first_name="OtherFaith" birth=1042.1.1 female=yes culture=75 rite=3 }
5={ first_name="SameHouse" birth=1042.1.1 female=yes culture=75 rite=1 dynasty_house=100 }
6={ first_name="Man" birth=1042.1.1 culture=75 rite=1 }
7={ first_name="Child" birth=1058.1.1 female=yes culture=75 rite=1 }
8={ first_name="Aelis" birth=1040.1.1 female=yes culture=12 rite=1 court_data={ employer=9 } alive_data={ fertility=0.9 } skill={ 5 5 20 5 5 5 } }
9={ first_name="Louis" family_data={ child={ 8 } } landed_data={ domain={ 12 } strength=4000 } }
10={ first_name="Courtier" birth=1041.1.1 female=yes culture=12 rite=1 court_data={ employer=9 } skill={ 5 5 20 5 5 5 } }
}
`);

test("lists unmarried same-faith adult women outside your house, local first", async () => {
  const r = await queryGamestate(GS, (q) =>
    extractMarriageCandidates(q, new Localizer(null), 1066),
  );
  expect(r!.you.age).toBe(39);
  expect(r!.candidates.map((c) => c.name)).toEqual(["Aoife", "Aelis", "Courtier"]);
  const aoife = r!.candidates[0]!;
  expect(aoife.sameCulture).toBe(true);
  expect(aoife.fertility).toBe(0.6);
  expect(aoife.home).toBeNull();
  const aelis = r!.candidates[1]!;
  expect(aelis.home?.name).toBe("Louis");
  expect(aelis.home?.realm).toBe("France");
  expect(aelis.nearby).toBe(false);
});

test("an alliance only counts for a daughter or sister of the ruler, and priority ranking leads with it", async () => {
  const run = (opts: { rank?: "local" | "priority"; minHomeStrength?: number }) =>
    queryGamestate(GS, (q) => extractMarriageCandidates(q, new Localizer(null), 1066, 12, opts));
  const r = await run({ rank: "priority" });
  // The ruler's daughter leads on alliance strength; the mere courtier (STE 20) gets no alliance credit.
  expect(r!.candidates[0]!.name).toBe("Aelis");
  const byName = Object.fromEntries(r!.candidates.map((c) => [c.name, c]));
  expect(byName["Aelis"]!.kinOfRuler).toBe("daughter");
  expect(byName["Courtier"]!.kinOfRuler).toBeNull();
  const strong = await run({ minHomeStrength: 1500 });
  expect(strong!.candidates.map((c) => c.name).sort()).toEqual(["Aelis", "Courtier"]);
});

test("character_id looks for a spouse for someone else, e.g. the heir", async () => {
  const r = await queryGamestate(GS, (q) =>
    extractMarriageCandidates(q, new Localizer(null), 1066, 12, { forCharacter: 6 }),
  );
  expect(r!.you).toEqual({ id: 6, name: "Man", age: 24 });
  // The subject has no house here, so the player's housemate is no longer excluded.
  expect(r!.candidates.map((c) => c.name)).toContain("SameHouse");
  expect(r!.candidates.map((c) => c.name)).not.toContain("Man");
});

test("a spouse with a ruling sibling or parent can unlock an alliance, a plain courtier cannot", async () => {
  const gs = Buffer.from(`
traits_lookup={ "just" }
played_character={ character=1 player=1 }
rites={ database={ 1={ faith=13 } } }
living={
1={ first_name="Murchad" birth=1027.1.1 culture=75 rite=1 landed_data={ domain={ 11 } } }
2={ first_name="Sister" birth=1042.1.1 female=yes culture=12 rite=1 court_data={ employer=3 } }
3={ first_name="Brother" birth=1035.1.1 rite=1 landed_data={ domain={ 12 } strength=3000 } }
4={ first_name="Plain" birth=1042.1.1 female=yes culture=12 rite=1 court_data={ employer=3 } }
5={ first_name="Dad" birth=1010.1.1 family_data={ child={ 2 3 } } }
}
`);
  const r = await queryGamestate(gs, (q) =>
    extractMarriageCandidates(q, new Localizer(null), 1066, 12, { rank: "priority" }),
  );
  const by = Object.fromEntries(r!.candidates.map((c) => [c.name, c]));
  expect(by["Sister"]!.allyRuler).toEqual({
    id: 3,
    name: "Brother",
    strength: 3000,
    relation: "sibling",
  });
  expect(by["Plain"]!.allyRuler).toBeNull();
  expect(r!.candidates[0]!.name).toBe("Sister");
});
