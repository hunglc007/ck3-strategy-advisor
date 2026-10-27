import { readFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";

/**
 * Localization folders of the mods the game would load. Like the game, this reads the
 * `dlc_load.json` in the user folder (written by the launcher), whose `enabled_mods` are
 * `.mod` files relative to that folder; each `.mod` names its content folder in `path`.
 * Folders are returned in load order, English first and then `replace`, so later ones win.
 */
export function modLocalizationDirs(userDir: string): string[] {
  let enabled: unknown;
  try {
    enabled = (
      JSON.parse(readFileSync(join(userDir, "dlc_load.json"), "utf8")) as Record<string, unknown>
    ).enabled_mods;
  } catch {
    return [];
  }
  if (!Array.isArray(enabled)) return [];
  const out: string[] = [];
  for (const rel of enabled) {
    if (typeof rel !== "string") continue;
    let text: string;
    try {
      text = readFileSync(isAbsolute(rel) ? rel : join(userDir, rel), "utf8");
    } catch {
      continue;
    }
    const m = /^\s*path\s*=\s*"([^"]+)"/m.exec(text);
    if (!m) continue;
    const root = isAbsolute(m[1]!) ? m[1]! : join(userDir, m[1]!);
    out.push(join(root, "localization", "english"), join(root, "localization", "replace"));
  }
  return out;
}
