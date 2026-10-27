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
