import fs from "node:fs";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { parseConfig } from "./src/config.js";
import { classify } from "./src/classifier.js";
import { reviewWithClaude } from "./src/reviewer.js";
import * as store from "./src/approval-store.js";
import { sendRiskReport, sendBlockNotice } from "./src/notifier.js";
import type { SecurityMode } from "./src/types.js";

// Water Mode imports
import { waterModeEnforce } from "./src/water/enforcement.js";
import { createWaterModeTools } from "./src/water/tools.js";
import { initAuditLog, writeAuditEntry, getRecentEntries } from "./src/water/audit-log.js";
import * as permitStore from "./src/water/permit-store.js";

function resolveApiKey(): string {
  const keyFile = process.env.SECURITY_REVIEW_API_KEY_FILE;
  if (keyFile) {
    try {
      return fs.readFileSync(keyFile, "utf8").trim();
    } catch {}
  }
  return process.env.SECURITY_REVIEW_API_KEY ?? "";
}

// Ring buffer for recent tool calls (Ice Mode attack chain detection)
const recentToolCalls: Array<{ tool: string; params: Record<string, unknown> }> = [];
const MAX_RECENT = 20;

function pushRecentTool(tool: string, params: Record<string, unknown>): void {
  recentToolCalls.unshift({ tool, params });
  if (recentToolCalls.length > MAX_RECENT) {
    recentToolCalls.length = MAX_RECENT;
  }
}

// Water Mode tools that must not be intercepted by the hook
const WATER_MODE_TOOLS = new Set(["submit_action_bundle", "check_permit"]);

const plugin = {
  id: "security-review",
  name: "Security Review",
  description:
    "Independent security review layer for all tool calls. Supports Ice Mode (human-approval) and Water Mode (SafeCheck agent gating).",

  register(api: OpenClawPluginApi) {
    const config = parseConfig(api.pluginConfig);
    const logger = api.logger;
    const apiKey = resolveApiKey();

    if (!config.enabled) {
      logger.info("Security review plugin disabled");
      return;
    }

    if (!apiKey) {
      logger.warn(
        "SECURITY_REVIEW_API_KEY not set — Claude API review unavailable, all ambiguous calls will require manual approval",
      );
    }

    // Current mode (mutable, changed by commands)
    let currentMode: SecurityMode = config.securityMode;

    logger.info(
      `Security review active: mode=${currentMode}, notify=${config.notifyChannel}:${config.notifyTo}, model=${config.reviewModel}`,
    );

    // Initialize audit log
    try {
      const stateDir = api.runtime.state.resolveStateDir();
      initAuditLog(stateDir);
    } catch {
      logger.warn("Could not initialize audit log (non-fatal)");
    }

    // ─── Register Water Mode tools ───
    const waterTools = createWaterModeTools({
      config: config.water,
      apiKey,
      logger: logger as never,
    });

    api.registerTool({
      ...waterTools.submitActionBundle,
      execute: async (params: Record<string, unknown>) => {
        return waterTools.submitActionBundle.execute(params, {});
      },
    });

    api.registerTool({
      ...waterTools.checkPermit,
      execute: async (params: Record<string, unknown>) => {
        return waterTools.checkPermit.execute(params, {});
      },
    });

    // ─── before_tool_call hook (priority 900) ───
    api.on(
      "before_tool_call",
      async (event, ctx) => {
        const { toolName, params } = event;

        // Exempt tools skip all checks (both modes)
        if (config.exemptTools.includes(toolName)) {
          store.recordAutoApproved();
          pushRecentTool(toolName, params);
          return;
        }

        // Water Mode's own tools must not be intercepted
        if (WATER_MODE_TOOLS.has(toolName)) {
          return;
        }

        // ─── Mode dispatch ───
        if (currentMode === "water") {
          return waterModeEnforce(toolName, params, ctx, config.water, logger as never);
        }

        // ─── Ice Mode (existing logic) ───
        return iceModeBefore(event);
      },
      { priority: 900 },
    );

    // Ice Mode handler (extracted from original inline)
    async function iceModeBefore(event: {
      toolName: string;
      params: Record<string, unknown>;
    }): Promise<{ block: true; blockReason: string } | void> {
      const { toolName, params } = event;

      // Step 1: Fast classifier
      const classification = classify(toolName, params, config);

      if (classification.level === "safe") {
        store.recordAutoApproved();
        pushRecentTool(toolName, params);
        return;
      }

      if (classification.level === "unsafe") {
        store.recordAutoBlocked();
        logger.warn(`BLOCKED ${toolName}: ${classification.reason}`);
        void sendBlockNotice({
          toolName,
          reason: classification.reason,
          config,
          runtime: api.runtime as never,
          logger,
        });
        return {
          block: true,
          blockReason: `Security review blocked: ${classification.reason}`,
        };
      }

      // Step 2: Claude API review (level === "review")
      const reviewResult = await reviewWithClaude({
        toolName,
        toolParams: params,
        classifierReason: classification.reason,
        recentTools: recentToolCalls.slice(),
        apiKey,
        model: config.reviewModel,
        timeoutMs: config.maxReviewTimeoutMs,
        logger,
      });

      if (reviewResult.decision === "safe") {
        store.recordAutoApproved();
        pushRecentTool(toolName, params);
        logger.info(`APPROVED by review: ${toolName} — ${reviewResult.summary}`);
        return;
      }

      if (reviewResult.decision === "unsafe") {
        store.recordAutoBlocked();
        logger.warn(`BLOCKED by review: ${toolName} — ${reviewResult.summary}`);
        void sendBlockNotice({
          toolName,
          reason: reviewResult.summary,
          config,
          runtime: api.runtime as never,
          logger,
        });
        return {
          block: true,
          blockReason: `Security review blocked: ${reviewResult.summary}`,
        };
      }

      // Step 3: needs_approval — ask human
      store.recordSentForReview();
      const expiresInSec = Math.round(config.approvalTimeoutMs / 1000);

      const { id, promise } = store.register({
        toolName,
        toolParams: params,
        risks: reviewResult.risks,
        summary: reviewResult.summary,
      });

      logger.info(`PENDING approval ${id}: ${toolName} — ${reviewResult.summary}`);

      void sendRiskReport({
        id,
        toolName,
        toolParams: params,
        summary: reviewResult.summary,
        risks: reviewResult.risks,
        expiresInSec,
        config,
        runtime: api.runtime as never,
        logger,
      });

      const timeoutId = setTimeout(() => {
        store.timeout(id);
        logger.warn(`TIMED OUT ${id}: ${toolName}`);
      }, config.approvalTimeoutMs);
      if (timeoutId.unref) timeoutId.unref();

      const approved = await promise;
      clearTimeout(timeoutId);

      if (approved) {
        pushRecentTool(toolName, params);
        logger.info(`APPROVED by human: ${id} ${toolName}`);
        return;
      }

      logger.warn(`DENIED by human/timeout: ${id} ${toolName}`);
      return {
        block: true,
        blockReason: `Security review: denied by operator (${id})`,
      };
    }

    // ─── after_tool_call hook — record for history ───
    api.on("after_tool_call", (event) => {
      pushRecentTool(event.toolName, event.params);
    });

    // ─── Ice Mode Commands ───

    api.registerCommand({
      name: "sec_approve",
      description: "Approve a pending security review (Ice Mode)",
      acceptsArgs: true,
      requireAuth: true,
      handler: (ctx) => {
        const id = ctx.args?.trim();
        if (!id) return { text: "Usage: /sec_approve <id>" };
        const ok = store.approve(id);
        if (ok) {
          logger.info(`Human approved ${id} via ${ctx.channel}`);
          return { text: `Approved: ${id}` };
        }
        return { text: `Not found or already resolved: ${id}` };
      },
    });

    api.registerCommand({
      name: "sec_deny",
      description: "Deny a pending security review (Ice Mode)",
      acceptsArgs: true,
      requireAuth: true,
      handler: (ctx) => {
        const id = ctx.args?.trim();
        if (!id) return { text: "Usage: /sec_deny <id>" };
        const ok = store.deny(id);
        if (ok) {
          logger.info(`Human denied ${id} via ${ctx.channel}`);
          return { text: `Denied: ${id}` };
        }
        return { text: `Not found or already resolved: ${id}` };
      },
    });

    api.registerCommand({
      name: "sec_pending",
      description: "List pending security reviews (Ice Mode)",
      acceptsArgs: false,
      requireAuth: true,
      handler: () => {
        const pending = store.getPending();
        if (pending.length === 0) return { text: "No pending security reviews." };
        const lines = pending.map((p) => {
          const age = Math.round((Date.now() - p.createdAt) / 1000);
          return `${p.id} | ${p.toolName} | ${p.summary} | ${age}s ago`;
        });
        return { text: `Pending reviews (${pending.length}):\n${lines.join("\n")}` };
      },
    });

    api.registerCommand({
      name: "sec_stats",
      description: "Show security review statistics",
      acceptsArgs: false,
      requireAuth: true,
      handler: () => {
        const s = store.getStats();
        const lines = [
          `Mode: ${currentMode.toUpperCase()}`,
          `Total checks: ${s.totalChecks}`,
          `Auto-approved: ${s.autoApproved}`,
          `Auto-blocked: ${s.autoBlocked}`,
          `Sent for review: ${s.sentForReview}`,
          `Human approved: ${s.humanApproved}`,
          `Human denied: ${s.humanDenied}`,
          `Timed out: ${s.timedOut}`,
        ];
        if (currentMode === "water") {
          const active = permitStore.getActivePermits();
          lines.push(`Active permits: ${active.length}`);
        }
        return { text: lines.join("\n") };
      },
    });

    // ─── Mode Switch Commands ───

    api.registerCommand({
      name: "switch_ice_mode",
      description: "Switch to Ice Mode (human-approval gating)",
      acceptsArgs: false,
      requireAuth: true,
      handler: () => {
        const prev = currentMode;
        currentMode = "ice";
        permitStore.revokeAll();
        writeAuditEntry({
          ts: Date.now(),
          type: "mode_switch",
          detail: { from: prev, to: "ice" },
        });
        logger.info(`Mode switched: ${prev} → ice`);
        return { text: "Switched to Ice Mode. All active permits revoked." };
      },
    });

    api.registerCommand({
      name: "switch_water_mode",
      description: "Switch to Water Mode (SafeCheck agent gating)",
      acceptsArgs: false,
      requireAuth: true,
      handler: () => {
        const prev = currentMode;
        currentMode = "water";
        writeAuditEntry({
          ts: Date.now(),
          type: "mode_switch",
          detail: { from: prev, to: "water" },
        });
        logger.info(`Mode switched: ${prev} → water`);
        return {
          text: "Switched to Water Mode. High-risk actions now require SafeCheck approval via submit_action_bundle.",
        };
      },
    });

    // ─── Water Mode Commands ───

    api.registerCommand({
      name: "sec_permits",
      description: "List active Water Mode permit tokens",
      acceptsArgs: false,
      requireAuth: true,
      handler: () => {
        const active = permitStore.getActivePermits();
        if (active.length === 0) return { text: "No active permits." };
        const lines = active.map((p) => {
          const remaining = Math.round((p.expiresAt - Date.now()) / 1000);
          const consumed = p.consumedActions.size;
          const total = p.bundle.actions.length;
          return `${p.id} | ${p.bundle.goal.slice(0, 60)} | ${consumed}/${total} used | ${remaining}s left`;
        });
        return { text: `Active permits (${active.length}):\n${lines.join("\n")}` };
      },
    });

    api.registerCommand({
      name: "sec_revoke",
      description: "Revoke a Water Mode permit token",
      acceptsArgs: true,
      requireAuth: true,
      handler: (ctx) => {
        const id = ctx.args?.trim();
        if (!id) return { text: "Usage: /sec_revoke <permit-id>" };
        const ok = permitStore.revokeById(id);
        if (ok) {
          logger.info(`Permit ${id} revoked via ${ctx.channel}`);
          return { text: `Revoked: ${id}` };
        }
        return { text: `Not found: ${id}` };
      },
    });

    api.registerCommand({
      name: "sec_audit",
      description: "Show recent security audit log entries",
      acceptsArgs: true,
      requireAuth: true,
      handler: (ctx) => {
        const count = parseInt(ctx.args?.trim() || "20", 10) || 20;
        const entries = getRecentEntries(Math.min(count, 50));
        if (entries.length === 0) return { text: "No audit log entries." };
        const lines = entries.map((e) => {
          const ts = new Date(e.ts).toISOString().slice(11, 19);
          const tool = e.toolName ? ` tool=${e.toolName}` : "";
          const permit = e.permitId ? ` permit=${e.permitId}` : "";
          return `${ts} ${e.type}${tool}${permit}`;
        });
        return { text: `Audit log (last ${entries.length}):\n${lines.join("\n")}` };
      },
    });

    // Periodic cleanup of expired permits
    const cleanupInterval = setInterval(() => {
      permitStore.revokeExpired();
    }, 60_000);
    if (cleanupInterval.unref) cleanupInterval.unref();
  },
};

export default plugin;
