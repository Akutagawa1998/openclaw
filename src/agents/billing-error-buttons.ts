/**
 * Build channel-specific model-switch options for billing error payloads.
 *
 * When a billing error occurs (API key out of credits), this module generates:
 * - Inline keyboard buttons for Telegram (one-tap model switch)
 * - A text suffix with /model commands for Discord and other channels
 */

import type { OpenClawConfig } from "../config/config.js";
import type { TelegramInlineButton, TelegramInlineButtons } from "../telegram/button-types.js";

/** Well-known provider display labels. */
const PROVIDER_LABELS: Record<string, string> = {
  anthropic: "Anthropic",
  openai: "OpenAI",
  google: "Google",
  ollama: "Ollama",
  mistral: "Mistral",
  groq: "Groq",
  deepseek: "DeepSeek",
  minimax: "MiniMax",
  xai: "xAI",
};

/** Default model to suggest per provider (strong, general-purpose picks). */
const PROVIDER_DEFAULT_MODELS: Record<string, string> = {
  anthropic: "claude-sonnet-4-6",
  openai: "gpt-4o",
  google: "gemini-2.0-flash",
  ollama: "llama3",
  mistral: "mistral-large-latest",
  groq: "llama-3.3-70b-versatile",
  deepseek: "deepseek-chat",
  minimax: "MiniMax-M2.5-highspeed",
  xai: "grok-3",
};

/**
 * Resolve which providers have auth profiles configured (excluding the failed one).
 */
function resolveAvailableProviders(params: {
  cfg: OpenClawConfig | undefined;
  failedProvider: string | undefined;
}): string[] {
  const { cfg, failedProvider } = params;
  if (!cfg) return [];

  const providers = new Set<string>();

  // Collect providers from model config
  const modelConfig = cfg.agents?.defaults?.model;
  if (typeof modelConfig === "string") {
    const slash = modelConfig.indexOf("/");
    if (slash > 0) providers.add(modelConfig.slice(0, slash));
  } else if (modelConfig && typeof modelConfig === "object") {
    const primary = (modelConfig as { primary?: string }).primary;
    if (typeof primary === "string") {
      const slash = primary.indexOf("/");
      if (slash > 0) providers.add(primary.slice(0, slash));
    }
    for (const fb of (modelConfig as { fallbacks?: string[] }).fallbacks ?? []) {
      const slash = fb.indexOf("/");
      if (slash > 0) providers.add(fb.slice(0, slash));
    }
  }

  // Collect providers from models.providers config
  const providersCfg = cfg.models?.providers;
  if (providersCfg && typeof providersCfg === "object") {
    for (const key of Object.keys(providersCfg)) {
      providers.add(key.toLowerCase());
    }
  }

  // Always include well-known providers that commonly have env-based keys
  for (const wellKnown of ["anthropic", "openai", "google"]) {
    providers.add(wellKnown);
  }

  // Remove the failed provider
  const failed = failedProvider?.toLowerCase();
  if (failed) providers.delete(failed);

  return [...providers].sort();
}

/**
 * Build Telegram inline buttons for switching to a different model provider.
 */
function buildTelegramBillingButtons(availableProviders: string[]): TelegramInlineButtons {
  if (availableProviders.length === 0) return [];

  const rows: TelegramInlineButton[][] = [];

  for (const provider of availableProviders) {
    const label = PROVIDER_LABELS[provider] ?? provider;
    const defaultModel = PROVIDER_DEFAULT_MODELS[provider];
    if (!defaultModel) continue;

    const callbackData = `mdl_sel_${provider}/${defaultModel}`;
    // Telegram callback_data max 64 bytes
    if (new TextEncoder().encode(callbackData).length > 64) continue;

    rows.push([
      {
        text: `Switch to ${label} (${defaultModel})`,
        callback_data: callbackData,
      },
    ]);
  }

  // Add a "browse all" button
  rows.push([
    {
      text: "Browse all providers",
      callback_data: "mdl_prov",
    },
  ]);

  return rows;
}

/**
 * Build a text suffix with model switch suggestions (for Discord and other channels).
 */
function buildModelSwitchTextSuffix(availableProviders: string[]): string {
  if (availableProviders.length === 0) return "";

  const lines: string[] = ["\n\nSwitch to an available provider:"];
  for (const provider of availableProviders) {
    const label = PROVIDER_LABELS[provider] ?? provider;
    const defaultModel = PROVIDER_DEFAULT_MODELS[provider];
    if (!defaultModel) continue;
    lines.push(`  /model ${provider}/${defaultModel}  (${label})`);
  }
  lines.push("\nUse /models to browse all available models.");
  return lines.join("\n");
}

export type BillingErrorSwitchResult = {
  /** Text suffix to append to the billing error message (for all channels). */
  textSuffix: string;
  /** channelData with Telegram inline buttons (for one-tap switching). */
  channelData: Record<string, unknown>;
};

/**
 * Build model-switch options for billing error payloads.
 * Returns text suffix + Telegram channelData, or undefined if no alternatives.
 */
export function buildBillingErrorModelSwitchButtons(params: {
  cfg: OpenClawConfig | undefined;
  failedProvider: string | undefined;
}): BillingErrorSwitchResult | undefined {
  const availableProviders = resolveAvailableProviders(params);
  if (availableProviders.length === 0) return undefined;

  const telegramButtons = buildTelegramBillingButtons(availableProviders);
  const textSuffix = buildModelSwitchTextSuffix(availableProviders);

  return {
    textSuffix,
    channelData: {
      telegram: { buttons: telegramButtons },
    },
  };
}
