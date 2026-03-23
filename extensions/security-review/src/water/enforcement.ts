import type { WaterModeConfig } from "./types.js";
import { isHighRisk } from "./high-risk-classifier.js";
import * as permitStore from "./permit-store.js";
import { writeAuditEntry } from "./audit-log.js";

type Logger = { info: (msg: string) => void; warn: (msg: string) => void; error: (msg: string) => void };

type ToolContext = {
  sessionId?: string;
  runId?: string;
  agentId?: string;
};

type BlockResult = { block: true; blockReason: string };

/**
 * Water Mode enforcement: check if the tool call has a valid permit.
 */
export function waterModeEnforce(
  toolName: string,
  params: Record<string, unknown>,
  ctx: ToolContext,
  config: WaterModeConfig,
  logger: Logger,
): BlockResult | undefined {
  // Step 1: Is this a high-risk tool call?
  if (!isHighRisk(toolName, params, config)) {
    return undefined; // allow through, no permit needed
  }

  const sessionId = ctx.sessionId ?? "";
  const runId = ctx.runId ?? "";

  // Step 2: Find a valid permit
  const match = permitStore.findValidPermit({
    sessionId,
    runId,
    toolName,
    toolParams: params,
  });

  if (!match) {
    writeAuditEntry({
      ts: Date.now(),
      type: "enforcement_blocked_no_permit",
      sessionId,
      runId,
      agentId: ctx.agentId,
      toolName,
      detail: { paramsPreview: truncateParams(params) },
    });
    logger.warn(`Water Mode BLOCKED ${toolName}: no valid permit`);
    return {
      block: true,
      blockReason:
        "Water Mode: No valid permit token found for this high-risk action. " +
        "You must submit an action bundle via the submit_action_bundle tool first.",
    };
  }

  const { permit, matchResult } = match;

  // Step 3: Check for expired permit (should not happen since findValidPermit checks, but belt-and-suspenders)
  if (permit.expiresAt <= Date.now()) {
    writeAuditEntry({
      ts: Date.now(),
      type: "enforcement_blocked_expired",
      sessionId,
      runId,
      toolName,
      permitId: permit.id,
      detail: { expiredAt: permit.expiresAt },
    });
    logger.warn(`Water Mode BLOCKED ${toolName}: permit ${permit.id} expired`);
    return {
      block: true,
      blockReason: `Water Mode: Permit ${permit.id} has expired. Submit a new action bundle.`,
    };
  }

  // Step 4: Check for param drift errors
  if (matchResult.driftErrors.length > 0) {
    writeAuditEntry({
      ts: Date.now(),
      type: "enforcement_blocked_param_drift",
      sessionId,
      runId,
      toolName,
      permitId: permit.id,
      detail: { driftErrors: matchResult.driftErrors },
    });
    logger.warn(
      `Water Mode BLOCKED ${toolName}: param drift — ${matchResult.driftErrors.join("; ")}`,
    );
    return {
      block: true,
      blockReason:
        `Water Mode: Action parameters differ from approved bundle. ` +
        `Drift: ${matchResult.driftErrors.join("; ")}. Submit a new action bundle.`,
    };
  }

  // Step 5: Allow and consume
  permitStore.markActionConsumed(permit.id, matchResult.actionIndex!);
  writeAuditEntry({
    ts: Date.now(),
    type: "enforcement_allowed",
    sessionId,
    runId,
    toolName,
    permitId: permit.id,
    detail: {
      actionIndex: matchResult.actionIndex,
      driftWarnings: matchResult.driftWarnings,
    },
  });
  logger.info(
    `Water Mode ALLOWED ${toolName}: permit ${permit.id}, action[${matchResult.actionIndex}]`,
  );

  return undefined; // allow through
}

function truncateParams(params: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(params)) {
    if (typeof value === "string" && value.length > 200) {
      result[key] = value.slice(0, 200) + "...";
    } else {
      result[key] = value;
    }
  }
  return result;
}
