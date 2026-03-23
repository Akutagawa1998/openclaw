import type { ReviewResult } from "./types.js";
import { buildReviewSystemPrompt, buildReviewUserPrompt } from "./prompt.js";

const FALLBACK_RESULT: ReviewResult = {
  decision: "needs_approval",
  summary: "Review failed (fail-closed)",
  risks: ["Could not complete automated review"],
  confidence: 0,
};

export async function reviewWithClaude(params: {
  toolName: string;
  toolParams: Record<string, unknown>;
  classifierReason: string;
  recentTools?: Array<{ tool: string; params: Record<string, unknown> }>;
  apiKey: string;
  model: string;
  timeoutMs: number;
  logger?: { info: (msg: string) => void; error: (msg: string) => void };
}): Promise<ReviewResult> {
  const { toolName, toolParams, classifierReason, recentTools, apiKey, model, timeoutMs, logger } =
    params;

  if (!apiKey) {
    logger?.error("SECURITY_REVIEW_API_KEY not set, fail-closed");
    return FALLBACK_RESULT;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    logger?.info(`Reviewing ${toolName} with ${model}`);

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model,
        max_tokens: 512,
        system: buildReviewSystemPrompt(),
        messages: [
          {
            role: "user",
            content: buildReviewUserPrompt(toolName, toolParams, classifierReason, recentTools),
          },
        ],
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      logger?.error(`Claude API error: ${response.status} ${body.slice(0, 200)}`);
      return FALLBACK_RESULT;
    }

    const data = (await response.json()) as {
      content?: Array<{ type: string; text?: string }>;
    };
    const text = data.content?.find((c) => c.type === "text")?.text ?? "";

    return parseReviewResponse(text, logger);
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      logger?.error(`Claude API review timed out after ${timeoutMs}ms`);
    } else {
      logger?.error(`Claude API review error: ${String(err)}`);
    }
    return FALLBACK_RESULT;
  } finally {
    clearTimeout(timeout);
  }
}

function parseReviewResponse(
  text: string,
  logger?: { error: (msg: string) => void },
): ReviewResult {
  try {
    // Strip markdown fences if present
    const cleaned = text
      .replace(/^```(?:json)?\s*/m, "")
      .replace(/\s*```\s*$/m, "")
      .trim();
    const parsed = JSON.parse(cleaned) as Record<string, unknown>;

    const decision = parsed.decision;
    if (decision !== "safe" && decision !== "unsafe" && decision !== "needs_approval") {
      logger?.error(`Invalid decision: ${String(decision)}`);
      return FALLBACK_RESULT;
    }

    return {
      decision,
      summary: typeof parsed.summary === "string" ? parsed.summary : "No summary",
      risks: Array.isArray(parsed.risks) ? parsed.risks.map(String) : [],
      confidence: typeof parsed.confidence === "number" ? parsed.confidence : 0.5,
    };
  } catch (err) {
    logger?.error(`Failed to parse review response: ${String(err)}`);
    return FALLBACK_RESULT;
  }
}
