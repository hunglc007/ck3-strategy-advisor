import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

// CK3_GAME_DIR may point at the install root ("…/Crusader Kings III") or at its
// "game" subfolder. Return whichever one actually holds the game data.
export function resolveGameRoot(gameDir: string | null): string | null {
  if (!gameDir) return null;
  const nested = join(gameDir, "game");
  if (existsSync(join(nested, "localization"))) return nested;
  return gameDir;
}

// Static data from the game install that the save does not carry. The save
// stores holdings per province id, but titles reference baronies by key; the
// barony -> province link lives only in common/landed_titles.
export class GameData {
  readonly baronyProvince = new Map<string, number>();
  readonly provinceBarony = new Map<number, string>();
  /** The folder holding `common/`, `events/`, `localization/`; null without a game dir. */
  readonly root: string | null;

  constructor(gameDir: string | null) {
    this.root = resolveGameRoot(gameDir);
    if (this.root) this.loadLandedTitles(join(this.root, "common", "landed_titles"));
  }

  private loadLandedTitles(dir: string): void {
    let names: string[];
    try {
      names = readdirSync(dir);
    } catch {
      return; // missing dir -> no mapping; tools fall back to raw ids
    }
    const re = /\b(b_[\w-]+)\s*=\s*\{\s*(?:#[^\n]*\n\s*)*province\s*=\s*(\d+)/g;
    for (const name of names) {
      if (!name.endsWith(".txt")) continue;
      const text = readFileSync(join(dir, name), "utf8");
      for (const m of text.matchAll(re)) {
        const province = Number(m[2]!);
        this.baronyProvince.set(m[1]!, province);
        this.provinceBarony.set(province, m[1]!);
      }
    }
  }
}
