import { expect, test } from "vitest";
import { queryGamestate } from "../src/parser.js";
import { Localizer } from "../src/localization.js";
import { extractPool } from "../src/extract/courtiers.js";

const GS = Buffer.from(`
traits_lookup={ "just" }
played_character={ character=1 player=1 }
rites={ database={ 1={ faith=13 } 2={ faith=13 } 3={ faith=9 } } }
living={
1={ first_name="Murchad" birth=1027.1.1 rite=1 landed_data={ domain={ 11 } } }
2={ first_name="Free" birth=1040.1.1 rite=2 skill={ 5 5 18 5 5 5 } traits={ 0 } }
3={ first_name="Employed" birth=1040.1.1 rite=1 court_data={ employer=1 } }
4={ first_name="OtherFaith" birth=1040.1.1 rite=3 }
5={ first_name="Landed" birth=1040.1.1 rite=1 landed_data={ domain={ 12 } } }
6={ first_name="Child" birth=1060.1.1 rite=1 }
7={ first_name="Old" birth=1000.1.1 rite=1 }
}
`);

test("lists only unattached, landless same-faith adults and adds trait skills", async () => {
  const r = await queryGamestate(GS, (q) => extractPool(q, new Localizer(null), null, 1066));
  expect(r!.characters.map((c) => c.name)).toEqual(["Free"]);
  expect(r!.faithMatched).toBe(1);
  expect(r!.region).toBeNull(); // no game files: not limited to a region
  expect(r!.characters[0]!.skills.stewardship).toBe(18);
});
