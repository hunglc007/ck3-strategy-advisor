import { expect, test } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { queryGamestate } from "../src/parser.js";
import { Localizer } from "../src/localization.js";
import { GameData } from "../src/gameData.js";
import { buildSnapshot } from "../src/snapshot.js";
import { extractAlerts } from "../src/extract/alerts.js";
import { extractCourt } from "../src/extract/court.js";
import { extractFamily } from "../src/extract/family.js";
import { extractDomain } from "../src/extract/domain.js";
import { extractIntrigue } from "../src/extract/intrigue.js";

const GS = readFileSync(
  fileURLToPath(new URL("./fixtures/extended-gamestate.txt", import.meta.url)),
);
const loc = new Localizer(null);

// A game install laid out as "<root>/game/common/landed_titles" (CK3_GAME_DIR
// pointing at the install root, not the "game" subfolder).
function fakeGameDir(): string {
  const root = mkdtempSync(join(tmpdir(), "ck3-game-"));
  const titles = join(root, "game", "common", "landed_titles");
  mkdirSync(titles, { recursive: true });
  mkdirSync(join(root, "game", "localization", "english"), { recursive: true });
  writeFileSync(
    join(titles, "00_landed_titles.txt"),
    "c_thomond = {\n\tb_limerick = {\n\t\tprovince = 45\n\t}\n\tb_roscrea = {\n\t\t# comment\n\t\tprovince = 46\n\t}\n}\n",
  );
  return root;
}

test("snapshot resolves 1.20 vassal contracts, council task seats and currency values", async () => {
  const snap = await buildSnapshot(GS, loc);
  expect(snap.vassals).toEqual([
    {
      id: 300,
      name: "Donal",
      strengthForLiege: 120,
      opinion: null,
      councilSeat: true,
      inFaction: false,
    },
  ]);
  expect(snap.overview.prestige).toBe(1300);
  expect(snap.overview.piety).toBe(150);
  expect(snap.overview.age).toBe(39);
  expect(snap.overview.spouses).toBe(0);
  expect(snap.overview.holdings).toBe(2);
  expect(snap.military.menAtArms).toEqual([
    { type: "light_footmen", size: 200, stationedProvince: 45 },
    { type: "bowmen", size: 100, stationedProvince: null },
  ]);
});

test("expansion lists de jure land outside the realm and CB targets", async () => {
  const snap = await buildSnapshot(GS, loc);
  // c_ormond is held by a vassal (inside the realm); c_desmond is outside.
  expect(snap.expansion.deJureOutsideRealm).toEqual([
    { title: "c_desmond", partOf: "Munster", holderId: 400, holderName: "Cormac" },
  ]);
  expect(snap.expansion.cbTargets).toEqual([
    { id: 400, name: "Cormac", primaryTitle: "c_desmond" },
  ]);
});

test("alerts group the player's important actions and skip other players'", async () => {
  const alerts = await queryGamestate(GS, (q) => extractAlerts(q, loc));
  expect(alerts.map((a) => a.type)).toEqual([
    "action_adult_ruler_not_married",
    "action_has_any_display_cb_on",
    "action_close_family_can_marry",
  ]);
  expect(alerts[0]!.targets).toEqual([]); // the player is not listed as their own target
  expect(alerts[2]!.targets.map((t) => t.name)).toEqual(["Brian", "Malachy"]);
});

test("court resolves council tasks, court positions, knights and best courtiers", async () => {
  const court = await queryGamestate(GS, (q) => extractCourt(q, loc, null, 2));
  expect(court.council.map((c) => [c.task, c.member.name])).toEqual([
    ["task_collect_taxes", "Donal"],
    ["task_foreign_affairs", "Conchobar"],
  ]);
  expect(court.positions.map((p) => [p.position, p.member.name])).toEqual([
    ["court_physician_court_position", "Malachy"],
  ]);
  expect(court.knights.map((k) => k.name)).toEqual(["Conchobar"]);
  expect(court.courtierCount).toBe(4);
  expect(court.bestBySkill.learning.map((e) => [e.member.name, e.holds])).toEqual([
    ["Malachy", "court_physician_court_position"],
    ["Gormlaith", null],
  ]);
});

test("family links parents from dead characters and labels heirs by kinship", async () => {
  const fam = await queryGamestate(GS, (q) => extractFamily(q));
  expect(fam!.parents.map((p) => [p.name, p.alive])).toEqual([["Donnchad", false]]);
  expect(fam!.children.map((c) => c.name)).toEqual(["Brian"]);
  expect(fam!.siblings.map((s) => [s.name, s.relation])).toEqual([["Conchobar", "brother"]]);
  expect(fam!.heirs.map((h) => [h.name, h.relation])).toEqual([
    ["Brian", "son"],
    ["Conchobar", "brother"],
    ["Malachy", "nephew"],
  ]);
  const conch = await queryGamestate(GS, (q) => extractFamily(q, 102));
  expect(conch!.spouses.map((s) => [s.name, s.relation])).toEqual([["Gormlaith", "wife"]]);
  expect(conch!.heirs).toEqual([]);
});

test("domain maps baronies to provinces via the game files", async () => {
  const game = new GameData(fakeGameDir());
  expect(game.baronyProvince.get("b_roscrea")).toBe(46);
  const d = await queryGamestate(GS, (q) => extractDomain(q, loc, game));
  expect(d.holdingCount).toBe(2);
  expect(d.counties).toHaveLength(1);
  expect(d.counties[0]).toMatchObject({
    title: "c_thomond",
    development: 6,
    control: 100,
    culture: "irish",
  });
  expect(d.counties[0]!.holdings[0]).toMatchObject({
    title: "b_limerick",
    province: 45,
    type: "castle_holding",
    buildings: ["building_castle_01"],
    emptySlots: 2,
    levy: 534,
    fortLevel: 3,
    isCapital: true,
  });
  // b_roscrea sits in a county the player doesn't hold.
  expect(d.looseHoldings.map((h) => h.title)).toEqual(["b_roscrea"]);
});

test("intrigue only reveals secrets the player knows, plus hooks both ways", async () => {
  const i = await queryGamestate(GS, (q) => extractIntrigue(q, loc));
  expect(i.knownSecrets).toEqual([
    { type: "secret_deviant", ownerId: 103, ownerName: "Malachy", targetName: null },
  ]);
  expect(i.ownSecrets).toEqual([
    {
      type: "secret_lover",
      ownerId: 100,
      ownerName: "Murchad",
      targetName: "Gormlaith",
      knownBy: 1,
    },
  ]);
  expect(i.hooksHeld).toEqual([{ type: "loyalty_hook", otherId: 300, otherName: "Donal" }]);
  expect(i.hooksAgainst).toEqual([
    { type: "house_head_hook", otherId: 102, otherName: "Conchobar" },
  ]);
});

test("Localizer.text strips CK3 markup and resolveTrait prefers trait_ keys", () => {
  const root = fakeGameDir();
  writeFileSync(
    join(root, "game", "localization", "english", "x_l_english.yml"),
    'l_english:\n action_x:1 "@war_icon! You are not [married|E]$SUFFIX$"\n SUFFIX:0 "!"\n trait_brave:0 "Brave"\n',
  );
  const l = new Localizer(root);
  expect(l.text("action_x")).toBe("You are not married!");
  l.setTraitLookup(["brave"]);
  expect(l.resolveTrait(0)).toBe("Brave");
});

test("a temple leased to the church (theocratic_lease) is not counted against the domain limit", async () => {
  const leased = Buffer.from(
    GS.toString("utf8").replace(
      '15={ key="b_roscrea"',
      '15={ key="b_roscrea" theocratic_lease=yes',
    ),
  );
  const snap = await buildSnapshot(leased, loc);
  expect(snap.overview.holdings).toBe(1); // Limerick only; Roscrea is leased
  const game = new GameData(fakeGameDir());
  const d = await queryGamestate(leased, (q) => extractDomain(q, loc, game));
  expect(d.holdingCount).toBe(1);
  const roscrea = [...d.counties.flatMap((c) => c.holdings), ...d.looseHoldings].find(
    (h) => h.title === "b_roscrea",
  );
  expect(roscrea).toMatchObject({ leased: true });
});
