/**
 * Briefing state persistence — simple JSON file in the plugin's data directory.
 */

import fs from "node:fs/promises";
import path from "node:path";
import type { BriefingState } from "./tool.js";
import { DEFAULT_BRIEFING_STATE } from "./tool.js";

export function createStateManager(stateDir: string) {
  const filePath = path.join(stateDir, "briefing-state.json");

  return {
    async load(): Promise<BriefingState> {
      try {
        const raw = await fs.readFile(filePath, "utf8");
        const parsed = JSON.parse(raw) as Partial<BriefingState>;
        return {
          ...DEFAULT_BRIEFING_STATE,
          ...parsed,
          facilities: { ...DEFAULT_BRIEFING_STATE.facilities, ...parsed.facilities },
        };
      } catch {
        return { ...DEFAULT_BRIEFING_STATE };
      }
    },

    async save(state: BriefingState): Promise<void> {
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, JSON.stringify(state, null, 2), "utf8");
    },
  };
}
