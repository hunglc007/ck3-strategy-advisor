import { expect, test } from "vitest";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Localizer } from "../src/localization.js";
import { modLocalizationDirs } from "../src/mods.js";
import { findCharacters } from "../src/extract/characters.js";

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "ck3-names-"));
  const game = join(root, "game");
  mkdirSync(join(game, "localization", "english", "names"), { recursive: true });
  writeFileSync(
    join(game, "localization", "english", "names", "n_l_english.yml"),
    'l_english:\n RO_gnvaldr:0 "Rögnvaldr"\n Gilla-PA_traic:0 "Gilla-Pátraic"\n',
  );
  const user = join(root, "user");
  mkdirSync(join(user, "mod", "Tr", "localization", "english"), { recursive: true });
  writeFileSync(join(user, "mod", "Tr.mod"), 'name="Tr"\npath="mod/Tr"\n');
  writeFileSync(join(user, "dlc_load.json"), JSON.stringify({ enabled_mods: ["mod/Tr.mod"] }));
  writeFileSync(
    join(user, "mod", "Tr", "localization", "english", "x_l_english.yml"),
    'l_english:\n RO_gnvaldr:0 "Rognvaldr II"\n',
  );
  return { game, user };
}

test("charName turns a stored name key into the text the game shows", () => {
  const { game } = fixture();
  const loc = new Localizer(game);
  expect(loc.charName("RO_gnvaldr")).toBe("Rögnvaldr");
  expect(loc.charName("Unknown")).toBe("Unknown");
});

test("enabled mods from dlc_load.json override base game text", () => {
  const { game, user } = fixture();
  const dirs = modLocalizationDirs(user);
  expect(dirs[0]).toContain("localization");
  expect(new Localizer(game, dirs).charName("RO_gnvaldr")).toBe("Rognvaldr II");
  expect(modLocalizationDirs(join(user, "missing"))).toEqual([]);
});

test("findCharacters matches the shown name without diacritics or hyphens", () => {
  const { game } = fixture();
  const loc = new Localizer(game);
  const text = '\nliving={\n1={\n\tfirst_name="Gilla-PA_traic"\n}\n}\nother={';
  const hit = findCharacters(text, "gilla patraic", (r) => loc.charName(r));
  expect(hit.map((h) => h.name)).toEqual(["Gilla-Pátraic"]);
});

test("trait names come from trait_<key>, falling back to the bare key", () => {
  const root = mkdtempSync(join(tmpdir(), "ck3-traits-"));
  mkdirSync(join(root, "localization", "english"), { recursive: true });
  writeFileSync(
    join(root, "localization", "english", "t_l_english.yml"),
    'l_english:\n trait_fecund:0 "Mắn đẻ"\n brave:0 "Brave"\n',
  );
  const loc = new Localizer(root);
  loc.setTraitLookup(["fecund", "brave", "unknown_trait"]);
  expect(loc.resolveTrait(0)).toBe("Mắn đẻ");
  expect(loc.resolveTrait(1)).toBe("Brave");
  expect(loc.resolveTrait(2)).toBe("unknown_trait");
});

import { queryGamestate } from "../src/parser.js";
import { fullName } from "../src/extract/names.js";

test("full name is first name plus house prefix and name, as the game shows it", async () => {
  const root = mkdtempSync(join(tmpdir(), "ck3-house-"));
  mkdirSync(join(root, "localization", "english"), { recursive: true });
  writeFileSync(
    join(root, "localization", "english", "h_l_english.yml"),
    'l_english:\n dynnp_d_:0 "d\'"\n dynn_Ivrea:0 "Ivrea"\n',
  );
  const gs = Buffer.from(`
dynasties={ dynasty_house={ 7={ name="dynn_Ivrea" prefix="dynnp_d_" } } }
living={
1={ first_name="Sybille" dynasty_house=7 }
2={ first_name="Pool" }
}
`);
  const loc = new Localizer(root);
  const names = await queryGamestate(gs, (q) => [fullName(q, loc, 1), fullName(q, loc, 2)]);
  expect(names).toEqual(["Sybille d'Ivrea", "Pool"]);
});

import { parseCouncilTaskRoles } from "../src/councilTasks.js";

test("council tasks map to their councillor from the file they are defined in", () => {
  const roles = parseCouncilTaskRoles([
    ["00_marshal_tasks.txt", "task_organize_levies = {\n}\ntask_increase_control = {\n}\n"],
    [
      "00_court_chaplain_tasks.txt",
      "task_religious_relations = {\n}\ntask_fabricate_claim = {\n}\n",
    ],
    ["00_spouse_tasks.txt", "task_manage_domain = {\n}\n"],
  ]);
  expect(roles.get("task_increase_control")).toBe("marshal");
  expect(roles.get("task_fabricate_claim")).toBe("court_chaplain");
  expect(roles.has("task_manage_domain")).toBe(false); // spouse tasks are not a council seat
});
