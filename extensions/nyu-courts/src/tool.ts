import {
  fetchFacilityStatus,
  fetchCourtStatus,
  SPECIAL_CLOSURES,
  type FacilitySchedule,
  type FacilityType,
  type LocationId,
} from "./scraper.js";

type Logger = {
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
};

// ── Formatting ──

function formatTime(isoStr: string): string {
  if (!isoStr) return "?";
  return new Date(isoStr).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/New_York",
  });
}

function formatDate(isoStr: string): string {
  if (!isoStr) return "?";
  return new Date(isoStr).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "America/New_York",
  });
}

function formatSchedule(schedules: FacilitySchedule[]): string {
  const now = new Date();
  const lines: string[] = [];
  lines.push("# NYU Facility Schedule");
  lines.push(
    `Queried: ${now.toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric", timeZone: "America/New_York" })} ${now.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", timeZone: "America/New_York" })}`,
  );

  // Check for special closures
  const todayStr = now.toISOString().slice(0, 10);
  for (const closure of SPECIAL_CLOSURES) {
    if ("date" in closure && closure.date === todayStr) {
      lines.push(`\n**Special: ${closure.label}** — ${closure.note}`);
    } else if ("start" in closure && "end" in closure && todayStr >= closure.start && todayStr <= closure.end) {
      lines.push(`\n**Special: ${closure.label}** — ${closure.note}`);
    }
  }

  lines.push("");

  for (const schedule of schedules) {
    lines.push(`## ${schedule.facility}`);
    if (schedule.staticHours) {
      lines.push(`General hours: ${schedule.staticHours}`);
    }
    if (schedule.note) {
      lines.push(`Note: ${schedule.note}`);
    }
    if (schedule.error) {
      lines.push(`Error: ${schedule.error}`);
    }

    if (schedule.events.length === 0 && !schedule.staticHours) {
      lines.push("No scheduled events found for this period.");
      lines.push("");
      continue;
    }

    if (schedule.events.length > 0) {
      // Group events by date
      const byDate = new Map<string, typeof schedule.events>();
      for (const event of schedule.events) {
        const dateKey = formatDate(event.start);
        const group = byDate.get(dateKey) || [];
        group.push(event);
        byDate.set(dateKey, group);
      }

      for (const [date, events] of byDate) {
        lines.push(`\n### ${date}`);
        for (const event of events) {
          const time = `${formatTime(event.start)} - ${formatTime(event.end)}`;
          lines.push(`- **${time}**: ${event.summary}`);
          if (event.location) lines.push(`  Location: ${event.location}`);
          if (event.description) {
            const desc = event.description.replace(/<[^>]*>/g, "").trim();
            if (desc) lines.push(`  Note: ${desc}`);
          }
        }
      }
    }
    lines.push("");
  }

  lines.push("---");
  lines.push(
    "Scheduled events indicate when areas are **occupied/reserved**. " +
    "Times without events are generally open during facility hours.",
  );

  return lines.join("\n");
}

// ── Facility Status Tool ──

const NyuFacilityStatusSchema = {
  type: "object" as const,
  additionalProperties: false,
  properties: {
    facility: {
      type: "string" as const,
      enum: ["basketball", "pool", "gym", "all"],
      description:
        'Facility type. "basketball" = courts, "pool" = swimming pools, "gym" = cardio/fitness/jogging track, "all" = everything. Default: "all".',
    },
    location: {
      type: "string" as const,
      enum: ["paulson", "paf", "all"],
      description:
        'Which location. "paulson" = John A. Paulson Center, "paf" = Palladium Athletic Facility, "all" = both + 404 Fitness. Default: "all".',
    },
    days: {
      type: "number" as const,
      description: "Days ahead to fetch (1 = today only, 7 = this week). Default: 7. Max: 14.",
    },
  },
};

export function createNyuFacilityStatusTool(params: { logger: Logger }) {
  const { logger } = params;

  return {
    name: "nyu_facility_status",
    label: "NYU Facility Status",
    description:
      "Query NYU athletic facility schedules including basketball courts, swimming pools, and gym/fitness areas " +
      "(Paulson Center, Palladium Athletic Facility, 404 Fitness). " +
      "Use this tool when the user asks about NYU gym hours, pool schedule, court availability, open gym times, " +
      "or anything related to NYU athletic facility access. Also triggered by keywords: nyucourt, nyupool, nyugym. " +
      "Returns scheduled events — times without events are open for use during facility hours.",
    parameters: NyuFacilityStatusSchema,
    async execute(_toolCallId: string, rawParams: Record<string, unknown>) {
      const facility = ((rawParams.facility as string) || "all") as FacilityType;
      const location = ((rawParams.location as string) || "all") as LocationId;
      let days = Number(rawParams.days) || 7;
      if (days < 1) days = 1;
      if (days > 14) days = 14;

      logger.info(`Fetching NYU facility status: facility=${facility}, location=${location}, days=${days}`);

      try {
        const schedules = await fetchFacilityStatus(facility, location, days);
        const formatted = formatSchedule(schedules);
        logger.info(`NYU facility status fetched: ${schedules.length} schedule(s)`);
        return { content: [{ type: "text" as const, text: formatted }] };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.error(`NYU facility status error: ${msg}`);
        return {
          content: [{
            type: "text" as const,
            text: `Failed to fetch NYU facility status: ${msg}\n\nCheck manually:\n- Facilities overview: https://gonyuathletics.com/sports/2021/2/25/nyu-athletics-facilities-hours-access.aspx`,
          }],
        };
      }
    },
  };
}

/** Backward-compatible alias — same tool, old name. */
export function createNyuCourtStatusTool(params: { logger: Logger }) {
  const tool = createNyuFacilityStatusTool(params);
  return {
    ...tool,
    name: "nyu_court_status",
    label: "NYU Basketball Court Status",
    description:
      "Query NYU basketball court availability (Paulson Courts 1-4 and PAF Main Court). " +
      "Alias for nyu_facility_status with facility=basketball. " +
      "Use when user asks about basketball courts, open gym, court availability, or says 'nyucourt'.",
    async execute(_toolCallId: string, rawParams: Record<string, unknown>) {
      // Force basketball-only
      return tool.execute(_toolCallId, { ...rawParams, facility: "basketball" });
    },
  };
}

// ── Briefing Config Tool ──

const NyuBriefingConfigSchema = {
  type: "object" as const,
  additionalProperties: false,
  required: ["action"],
  properties: {
    action: {
      type: "string" as const,
      enum: ["status", "enable", "disable", "enable_facility", "disable_facility"],
      description:
        '"status" = show current briefing config. ' +
        '"enable" = enable daily briefing (creates cron job at 6:30 AM ET). ' +
        '"disable" = disable daily briefing (removes cron job). ' +
        '"enable_facility" / "disable_facility" = toggle a specific facility in the briefing.',
    },
    facility: {
      type: "string" as const,
      enum: ["basketball", "pool", "gym"],
      description: 'Which facility to enable/disable (required for enable_facility/disable_facility).',
    },
  },
};

export type BriefingState = {
  enabled: boolean;
  facilities: {
    basketball: boolean;
    pool: boolean;
    gym: boolean;
  };
  cronJobId?: string;
};

export const DEFAULT_BRIEFING_STATE: BriefingState = {
  enabled: false,
  facilities: { basketball: true, pool: true, gym: true },
};

type BriefingDeps = {
  logger: Logger;
  loadState: () => Promise<BriefingState>;
  saveState: (state: BriefingState) => Promise<void>;
  createCronJob: (state: BriefingState) => Promise<string>;
  deleteCronJob: (jobId: string) => Promise<void>;
};

export function createNyuBriefingConfigTool(deps: BriefingDeps) {
  const { logger, loadState, saveState, createCronJob, deleteCronJob } = deps;

  return {
    name: "nyu_briefing_config",
    label: "NYU Daily Briefing Config",
    description:
      "Manage the NYU daily facility briefing notification. " +
      "Can enable/disable the daily 6:30 AM briefing and toggle which facilities " +
      "(basketball, pool, gym) are included. " +
      "Use when user says: enable/disable daily briefing, turn on/off briefing, " +
      "stop sending morning reports, add/remove pool from briefing, etc.",
    parameters: NyuBriefingConfigSchema,
    async execute(_toolCallId: string, rawParams: Record<string, unknown>) {
      const action = rawParams.action as string;
      const facility = rawParams.facility as string | undefined;

      try {
        const state = await loadState();

        switch (action) {
          case "status": {
            const facilityList = Object.entries(state.facilities)
              .map(([k, v]) => `${k}: ${v ? "ON" : "OFF"}`)
              .join(", ");
            return {
              content: [{
                type: "text" as const,
                text: `NYU Daily Briefing: ${state.enabled ? "ENABLED" : "DISABLED"}\n` +
                  `Schedule: 6:30 AM ET daily\n` +
                  `Facilities: ${facilityList}\n` +
                  `Cron job ID: ${state.cronJobId || "(none)"}`,
              }],
            };
          }

          case "enable": {
            if (state.enabled && state.cronJobId) {
              return { content: [{ type: "text" as const, text: "Daily briefing is already enabled." }] };
            }
            const jobId = await createCronJob(state);
            state.enabled = true;
            state.cronJobId = jobId;
            await saveState(state);
            logger.info(`Daily briefing enabled, cron job: ${jobId}`);
            return {
              content: [{
                type: "text" as const,
                text: `Daily briefing ENABLED. Cron job created (ID: ${jobId}).\n` +
                  `You'll receive a facility briefing at 6:30 AM ET every day.`,
              }],
            };
          }

          case "disable": {
            if (!state.enabled) {
              return { content: [{ type: "text" as const, text: "Daily briefing is already disabled." }] };
            }
            if (state.cronJobId) {
              await deleteCronJob(state.cronJobId).catch((err) =>
                logger.warn(`Failed to delete cron job ${state.cronJobId}: ${err}`),
              );
            }
            state.enabled = false;
            state.cronJobId = undefined;
            await saveState(state);
            logger.info("Daily briefing disabled");
            return { content: [{ type: "text" as const, text: "Daily briefing DISABLED." }] };
          }

          case "enable_facility":
          case "disable_facility": {
            if (!facility || !["basketball", "pool", "gym"].includes(facility)) {
              return {
                content: [{ type: "text" as const, text: 'Please specify facility: "basketball", "pool", or "gym".' }],
              };
            }
            const key = facility as keyof typeof state.facilities;
            state.facilities[key] = action === "enable_facility";
            await saveState(state);
            return {
              content: [{
                type: "text" as const,
                text: `${facility} in daily briefing: ${state.facilities[key] ? "ENABLED" : "DISABLED"}`,
              }],
            };
          }

          default:
            return { content: [{ type: "text" as const, text: `Unknown action: ${action}` }] };
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.error(`Briefing config error: ${msg}`);
        return { content: [{ type: "text" as const, text: `Error: ${msg}` }] };
      }
    },
  };
}
