import { expect, test } from "vitest";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GameLookup, parseTopLevel } from "../src/gameLookup.js";
import { Localizer } from "../src/localization.js";

// Game files start with a UTF-8 BOM; keep it so the parser is exercised on real input.
const BOM = String.fromCharCode(0xfeff);
const MAA = `${BOM}# costs
@maa_buy_cost = 150
@infantry = 100

huscar = { # trailing comment with a { brace
	damage = 40
	name_hint = "a } quoted brace"
	buy_cost = { gold = @maa_buy_cost }
	counters = { pikemen = 1 }
}
# commented_out = { x = 1 }
archers = {
	damage = 20
}
`;

test("parseTopLevel finds blocks and constants, ignoring braces in comments and strings", () => {
  const { blocks, vars } = parseTopLevel(MAA);
  expect(blocks.map((b) => b.key)).toEqual(["huscar", "archers"]);
  expect(vars.get("@maa_buy_cost")).toBe("150");
  const huscar = MAA.slice(blocks[0]!.start, blocks[0]!.end);
  expect(huscar.endsWith("}")).toBe(true);
  expect(huscar).toContain("counters");
  expect(huscar).not.toContain("archers");
});

test("parseTopLevel keeps scalars and @[...] formulas only when asked", () => {
  const src = "@base = 10\ncost = @[base * 2]\nplain = 5\nblock = { x = 1 }\n";
  expect(parseTopLevel(src).blocks.map((b) => b.key)).toEqual(["block"]);
  const { blocks } = parseTopLevel(src, { scalars: true });
  expect(blocks.map((b) => src.slice(b.start, b.end))).toEqual([
    "cost = @[base * 2]",
    "plain = 5",
    "block = { x = 1 }",
  ]);
});

function fakeGame(): string {
  const root = mkdtempSync(join(tmpdir(), "ck3-lookup-"));
  const maa = join(root, "common", "men_at_arms_types");
  const values = join(root, "common", "script_values");
  const loc = join(root, "localization", "english");
  for (const d of [maa, values, loc]) mkdirSync(d, { recursive: true });
  writeFileSync(join(maa, "00_a.txt"), MAA);
  // a later file redefines archers (the last definition wins in game)
  writeFileSync(join(maa, "01_b.txt"), "archers = {\n\tdamage = 25\n}\n");
  writeFileSync(
    join(values, "00_v.txt"),
    "@heavy = 100\nheavy_cost = @[heavy]\nhuscar_cost = @[heavy * 1.28]\n",
  );
  writeFileSync(
    join(loc, "regiment_l_english.yml"),
    'l_english:\n huscar:0 "Huscarls"\n huscar_flavor:1 "#F Shield [wall|E] fighters #!"\n archers:0 "Archers"\n',
  );
  return root;
}

test("lookup indexes a category, substitutes constants, and lets later files override", () => {
  const root = fakeGame();
  const g = new GameLookup(root, new Localizer(root));
  expect(g.available).toBe(true);

  const huscar = g.get("men_at_arms", "huscar")!;
  expect(g.displayName(huscar)).toBe("Huscarls");
  expect(g.description(huscar)).toBe("Shield wall fighters");
  expect(huscar.file).toBe("common/men_at_arms_types/00_a.txt");
  expect(huscar.line).toBe(5);
  expect(huscar.text).toContain("gold = 150"); // @maa_buy_cost substituted

  const archers = g.get("men_at_arms", "archers")!;
  expect(archers.file).toBe("common/men_at_arms_types/01_b.txt");
  expect(archers.text).toContain("damage = 25");
  expect(archers.overrides).toBe(1);

  expect(g.get("men_at_arms", "HUSCAR")?.key).toBe("huscar"); // case-insensitive fallback
  expect(g.get("men_at_arms", "nope")).toBeNull();
  expect(g.suggest("men_at_arms", "husc")).toEqual(["huscar"]);
});

test("script values evaluate @[...] formulas from file constants", () => {
  const root = fakeGame();
  const g = new GameLookup(root, new Localizer(root));
  expect(g.get("script_value", "heavy_cost")!.text).toBe("heavy_cost = 100 /* @[heavy] */");
  expect(g.get("script_value", "huscar_cost")!.text).toBe(
    "huscar_cost = 128 /* @[heavy * 1.28] */",
  );
});

test("search ranks exact key and name matches first and respects the limit", () => {
  const root = fakeGame();
  const g = new GameLookup(root, new Localizer(root));
  const hits = g.search("huscarls", "men_at_arms", 10);
  expect(hits.map((h) => h.entry.key)).toEqual(["huscar"]);
  expect(g.search("archers", undefined, 10)[0]!.entry.key).toBe("archers");
  expect(g.search("a", "men_at_arms", 1)).toHaveLength(1);
  expect(g.search("zzz", undefined, 10)).toEqual([]);
});

test("without a game dir the lookup reports itself unavailable", () => {
  const g = new GameLookup(null, new Localizer(null));
  expect(g.available).toBe(false);
  expect(g.search("x", "trait", 5)).toEqual([]);
});

test("Localizer.text drops script calls but keeps concept links", () => {
  const root = fakeGame();
  writeFileSync(
    join(root, "localization", "english", "x_l_english.yml"),
    "l_english:\n k:0 \"Give [ROOT.Char.Custom2('X', ROOT)|E] a [burial|E]\"\n",
  );
  expect(new Localizer(root).text("k")).toBe("Give a burial");
});
