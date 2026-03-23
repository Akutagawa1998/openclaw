import type { WaterModeConfig } from "./types.js";
import { validateBundle, canonicalBundleHash } from "./action-bundle.js";
import { safeCheckReview } from "./safecheck-agent.js";
import * as permitStore from "./permit-store.js";
import { writeAuditEntry } from "./audit-log.js";

type Logger = { info: (msg: string) => void; warn: (msg: string) => void; error: (msg: string) => void };

type ToolContext = {
  sessionId?: string;
  runId?: string;
  agentId?: string;
};

/**
 * Returns the tool definitions for Water Mode.
 * These are registered via api.registerTool().
 */
export function createWaterModeTools(params: {
  config: WaterModeConfig;
  apiKey: string;
  logger: Logger;
}) {
  const { config, apiKey, logger } = params;

  return {
    submitActionBundle: {
      name: "submit_action_bundle",
      description:
        "Submit an action bundle for SafeCheck security review. Required before executing " +
        "high-risk operations (exec, sensitive file writes) in Water Mode. Returns a permit " +
        "token if approved, or a denial reason if rejected.",
      parameters: {
        type: "object" as const,
        properties: {
          goal: {
            type: "string",
            description: "What you are trying to accomplish",
          },
          actions: {
            type: "array",
            description: "Ordered list of planned actions",
            items: {
              type: "object",
              properties: {
                tool: { type: "string", description: "Tool name (exec, write, edit, etc.)" },
                params: { type: "object", description: "Expected tool parameters" },
                expectedImpact: { type: "string", description: "What this action will change" },
                rollback: { type: "string", description: "How to undo this action (optional)" },
              },
              required: ["tool", "params", "expectedImpact"],
            },
          },
          filePaths: {
            type: "array",
            items: { type: "string" },
            description: "File paths involved in the actions",
          },
          networkTargets: {
            type: "array",
            items: {
              type: "object",
              properties: {
                domain: { type: "string" },
                port: { type: "number" },
                protocol: { type: "string" },
              },
            },
            description: "Network targets (optional)",
          },
          downloadSources: {
            type: "array",
            items: {
              type: "object",
              properties: {
                url: { type: "string" },
                expectedChecksum: { type: "string" },
                packageManager: { type: "string" },
              },
              required: ["url"],
            },
            description: "Download sources (optional)",
          },
          sensitiveDataCategories: {
            type: "array",
            items: { type: "string" },
            description: "Sensitive data categories that may be touched (optional)",
          },
        },
        required: ["goal", "actions", "filePaths"],
      },
      execute: async (
        toolParams: Record<string, unknown>,
        ctx: ToolContext,
      ): Promise<Record<string, unknown>> => {
        const sessionId = ctx.sessionId ?? "";
        const runId = ctx.runId ?? "";

        // Validate bundle
        const validation = validateBundle(toolParams);
        if (!validation.valid) {
          return {
            approved: false,
            reason: `Invalid action bundle: ${validation.errors.join("; ")}`,
          };
        }

        const bundle = validation.bundle;
        const bundleHash = canonicalBundleHash(bundle);

        writeAuditEntry({
          ts: Date.now(),
          type: "bundle_submitted",
          sessionId,
          runId,
          agentId: ctx.agentId,
          bundleHash,
          detail: { goal: bundle.goal, actionCount: bundle.actions.length },
        });

        // SafeCheck review
        const result = await safeCheckReview({ bundle, apiKey, config, logger });

        writeAuditEntry({
          ts: Date.now(),
          type: result.hardDenyRule ? "bundle_hard_denied" : "bundle_reviewed",
          sessionId,
          runId,
          bundleHash,
          detail: {
            decision: result.decision,
            summary: result.summary,
            confidence: result.confidence,
            riskTags: result.riskTags,
            hardDenyRule: result.hardDenyRule,
          },
        });

        if (result.decision === "deny") {
          writeAuditEntry({
            ts: Date.now(),
            type: "permit_denied",
            sessionId,
            runId,
            bundleHash,
            detail: { reason: result.summary },
          });
          logger.warn(`SafeCheck DENIED bundle: ${result.summary}`);
          return {
            approved: false,
            reason: result.summary,
            risks: result.risks,
            riskTags: result.riskTags,
          };
        }

        // Grant permit
        const permit = permitStore.grantPermit({
          sessionId,
          runId,
          bundle,
          bundleHash,
          ttlMs: config.permitTtlMs,
          reviewSummary: result.summary,
          riskTags: result.riskTags,
        });

        writeAuditEntry({
          ts: Date.now(),
          type: "permit_granted",
          sessionId,
          runId,
          permitId: permit.id,
          bundleHash,
          detail: { ttlMs: config.permitTtlMs, expiresAt: permit.expiresAt },
        });

        logger.info(`SafeCheck APPROVED — permit ${permit.id} granted (TTL ${config.permitTtlMs}ms)`);

        return {
          approved: true,
          permitId: permit.id,
          expiresAt: new Date(permit.expiresAt).toISOString(),
          ttlMs: config.permitTtlMs,
          summary: result.summary,
          message:
            "Action bundle approved. You may now execute the planned actions. " +
            `Permit expires at ${new Date(permit.expiresAt).toISOString()}.`,
        };
      },
    },

    checkPermit: {
      name: "check_permit",
      description:
        "Check active permit tokens for the current session. Use this to verify if you " +
        "have a valid permit before attempting high-risk actions.",
      parameters: {
        type: "object" as const,
        properties: {},
      },
      execute: async (
        _toolParams: Record<string, unknown>,
        ctx: ToolContext,
      ): Promise<Record<string, unknown>> => {
        const sessionId = ctx.sessionId ?? "";
        const runId = ctx.runId ?? "";

        const active = permitStore.getActivePermits().filter(
          (p) => p.sessionId === sessionId && p.runId === runId,
        );

        if (active.length === 0) {
          return {
            permits: [],
            message: "No active permits for this session. Submit an action bundle to get one.",
          };
        }

        return {
          permits: active.map((p) => ({
            id: p.id,
            goal: p.bundle.goal,
            totalActions: p.bundle.actions.length,
            consumedActions: p.consumedActions.size,
            remainingActions: p.bundle.actions.length - p.consumedActions.size,
            expiresAt: new Date(p.expiresAt).toISOString(),
            remainingMs: p.expiresAt - Date.now(),
            riskTags: p.riskTags,
          })),
        };
      },
    },
  };
}
