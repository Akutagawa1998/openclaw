import type { SecurityReviewConfig } from "./types.js";

type PluginRuntime = {
  channel: {
    telegram: {
      sendMessageTelegram: (to: string, text: string, opts?: Record<string, unknown>) => Promise<unknown>;
    };
    discord: {
      sendMessageDiscord: (to: string, text: string, opts?: Record<string, unknown>) => Promise<unknown>;
    };
  };
};

export async function sendRiskReport(params: {
  id: string;
  toolName: string;
  toolParams: Record<string, unknown>;
  summary: string;
  risks: string[];
  expiresInSec: number;
  config: SecurityReviewConfig;
  runtime: PluginRuntime;
  logger?: { info: (msg: string) => void; error: (msg: string) => void };
}): Promise<void> {
  const { id, toolName, toolParams, summary, risks, expiresInSec, config, runtime, logger } =
    params;

  const paramsStr = JSON.stringify(toolParams, null, 2);
  const truncatedParams = paramsStr.length > 500 ? paramsStr.slice(0, 500) + "..." : paramsStr;

  const lines = [
    "Security Review: Action Required",
    `ID: ${id}`,
    `Tool: ${toolName}`,
    `Risk: ${summary}`,
  ];

  if (risks.length > 0) {
    lines.push("Risks:");
    for (const risk of risks) {
      lines.push(`  - ${risk}`);
    }
  }

  lines.push(`Parameters: ${truncatedParams}`);
  lines.push(`Expires in: ${expiresInSec}s`);
  lines.push(`Reply: /sec_approve ${id}  or  /sec_deny ${id}`);

  const text = lines.join("\n");

  try {
    if (config.notifyChannel === "telegram" && config.notifyTo) {
      await runtime.channel.telegram.sendMessageTelegram(config.notifyTo, text, {});
      logger?.info(`Risk report sent to Telegram ${config.notifyTo}`);
    } else if (config.notifyChannel === "discord" && config.notifyTo) {
      await runtime.channel.discord.sendMessageDiscord(config.notifyTo, text, {});
      logger?.info(`Risk report sent to Discord ${config.notifyTo}`);
    } else {
      logger?.error(`No valid notification target: channel=${config.notifyChannel} to=${config.notifyTo}`);
    }
  } catch (err) {
    logger?.error(`Failed to send risk report: ${String(err)}`);
  }
}

export async function sendBlockNotice(params: {
  toolName: string;
  reason: string;
  config: SecurityReviewConfig;
  runtime: PluginRuntime;
  logger?: { error: (msg: string) => void };
}): Promise<void> {
  const { toolName, reason, config, runtime, logger } = params;
  const text = `Security Review: Blocked\nTool: ${toolName}\nReason: ${reason}`;

  try {
    if (config.notifyChannel === "telegram" && config.notifyTo) {
      await runtime.channel.telegram.sendMessageTelegram(config.notifyTo, text, {});
    } else if (config.notifyChannel === "discord" && config.notifyTo) {
      await runtime.channel.discord.sendMessageDiscord(config.notifyTo, text, {});
    }
  } catch (err) {
    logger?.error(`Failed to send block notice: ${String(err)}`);
  }
}
