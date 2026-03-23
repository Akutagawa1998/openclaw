import path from "node:path";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import {
  createNyuFacilityStatusTool,
  createNyuCourtStatusTool,
  createNyuBriefingConfigTool,
  type BriefingState,
} from "./src/tool.js";
import { createStateManager } from "./src/state.js";

const CRON_JOB_ID = "nyu-daily-briefing";

function buildCronMessage(state: BriefingState): string {
  const facilities = Object.entries(state.facilities)
    .filter(([, v]) => v)
    .map(([k]) => k);
  const facilityParam = facilities.length === 3 ? "all" : facilities[0] || "all";
  return (
    `Use nyu_facility_status with days=1 and facility=${facilityParam}. ` +
    `Provide a concise Chinese briefing of today's facility schedule. ` +
    `Focus on: open/close times, free play basketball periods, pool swim times, gym hours, and any closures or special events.`
  );
}

const plugin = {
  id: "nyu-courts",
  name: "NYU Courts",
  description: "Query NYU athletic facility schedules (basketball, pool, gym) and daily briefing.",

  register(api: OpenClawPluginApi) {
    const logger = api.logger;

    // State directory for briefing config
    const configDir = path.join(
      process.env.HOME || "/home/node",
      ".openclaw",
      "state",
      "plugins",
      "nyu-courts",
    );
    const stateManager = createStateManager(configDir);

    // Register main facility status tool
    api.registerTool(createNyuFacilityStatusTool({ logger }));

    // Register backward-compatible basketball-only tool
    api.registerTool(createNyuCourtStatusTool({ logger }));

    // Register briefing config tool with cron management
    api.registerTool(
      createNyuBriefingConfigTool({
        logger,
        loadState: () => stateManager.load(),
        saveState: (s) => stateManager.save(s),
        createCronJob: async (state) => {
          // Use the gateway cron API via the runtime
          const job = {
            id: CRON_JOB_ID,
            schedule: { kind: "cron", expr: "30 6 * * *", tz: "America/New_York" },
            payload: {
              kind: "agentTurn",
              message: buildCronMessage(state),
              deliver: true,
              channel: "last",
            },
            delivery: { mode: "announce", channel: "last" },
            sessionTarget: "isolated",
          };

          // Write cron job directly to the jobs store
          const cronDir = path.join(
            process.env.HOME || "/home/node",
            ".openclaw",
            "cron",
          );
          const jobsPath = path.join(cronDir, "jobs.json");
          const fs = await import("node:fs/promises");
          await fs.mkdir(cronDir, { recursive: true });

          let jobs: Record<string, unknown> = {};
          try {
            const raw = await fs.readFile(jobsPath, "utf8");
            jobs = JSON.parse(raw);
          } catch {
            // Start fresh
          }

          jobs[CRON_JOB_ID] = job;
          await fs.writeFile(jobsPath, JSON.stringify(jobs, null, 2), "utf8");
          logger.info(`Cron job ${CRON_JOB_ID} written to ${jobsPath}`);
          return CRON_JOB_ID;
        },
        deleteCronJob: async (jobId) => {
          const cronDir = path.join(
            process.env.HOME || "/home/node",
            ".openclaw",
            "cron",
          );
          const jobsPath = path.join(cronDir, "jobs.json");
          const fs = await import("node:fs/promises");

          try {
            const raw = await fs.readFile(jobsPath, "utf8");
            const jobs = JSON.parse(raw) as Record<string, unknown>;
            delete jobs[jobId];
            await fs.writeFile(jobsPath, JSON.stringify(jobs, null, 2), "utf8");
            logger.info(`Cron job ${jobId} removed from ${jobsPath}`);
          } catch (err) {
            logger.warn(`Could not remove cron job ${jobId}: ${err}`);
          }
        },
      }),
    );

    logger.info("NYU Courts extension active (basketball + pool + gym + briefing)");
  },
};

export default plugin;
