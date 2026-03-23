import type { ActionBundle, SafeCheckResult, WaterModeConfig } from "./types.js";
import { buildSafeCheckSystemPrompt, buildSafeCheckUserPrompt } from "./safecheck-prompt.js";

type Logger = { info: (msg: string) => void; error: (msg: string) => void };

const DENY_RESULT: SafeCheckResult = {
  decision: "deny",
  summary: "SafeCheck review failed (fail-closed)",
  risks: ["Could not complete automated review"],
  riskTags: [],
  confidence: 0,
};

// ─── Regex patterns reused from Ice Mode classifier ───

const EXFIL_PATTERNS = [
  /\bcurl\b.*\s-[dX]/i,
  /\bcurl\b.*--data/i,
  /\bwget\b.*--post/i,
  /\bnc\b.*-[ecl]/i,
  /\bnetcat\b/i,
  /\bncat\b/i,
  /\bsocat\b/i,
  /\bssh\b.*-R/i,
  /\bscp\b/i,
  /\brsync\b/i,
  /\bftp\b/i,
  />\s*\/dev\/tcp\//i,
];

const ENV_SECRET_PATTERNS = [
  /\benv\b/,
  /\bprintenv\b/,
  /\bset\b\s*$/m,
  /\$\{?\w*(KEY|TOKEN|SECRET|PASSWORD|PRIVATE)\w*\}?/i,
  /\becho\b.*\$\{?\w*(KEY|TOKEN|SECRET|PASSWORD|PRIVATE)/i,
  /\/proc\/\d+\/environ/,
  /\/proc\/self\/environ/,
];

const DESTRUCTIVE_PATTERNS = [
  /\brm\b.*-[rR]f/,
  /\brm\b.*-f[rR]/,
  /\bdd\b.*of=/,
  /\bmkfs\b/,
  /\bshred\b/,
  /\bkill\b.*-9/,
  /\bkillall\b/,
  /\bpkill\b/,
  /\bchmod\b.*777/,
  /\bchown\b.*root/,
];

const PRIVESC_PATTERNS = [
  /\bsudo\b/,
  /\bsu\b\s+-/,
  /\bchroot\b/,
  /\bunshare\b/,
  /\bnsenter\b/,
  /\bcapsh\b/,
  /\bsetcap\b/,
];

const SENSITIVE_PATH_PATTERNS = [
  /\.env$/i,
  /credentials/i,
  /secrets\.enc/i,
  /\.key$/i,
  /\.pem$/i,
  /\/proc\/\d+\/environ/,
  /\/proc\/self\/environ/,
];

/**
 * Run the SafeCheck review pipeline: rules engine hard-deny → Claude API review.
 */
export async function safeCheckReview(params: {
  bundle: ActionBundle;
  apiKey: string;
  config: WaterModeConfig;
  logger?: Logger;
}): Promise<SafeCheckResult> {
  const { bundle, apiKey, config, logger } = params;

  // Phase 1: Rules engine hard deny
  const hardDeny = runRulesEngine(bundle);
  if (hardDeny) {
    return hardDeny;
  }

  // Phase 2: Claude API review
  if (!apiKey) {
    logger?.error("SECURITY_REVIEW_API_KEY not set, fail-closed");
    return DENY_RESULT;
  }

  return await reviewBundleWithClaude({ bundle, apiKey, config, logger });
}

/**
 * Rules engine: check each action against hard-deny patterns.
 * Returns SafeCheckResult if denied, null if passes.
 */
function runRulesEngine(bundle: ActionBundle): SafeCheckResult | null {
  const execActions = bundle.actions.filter((a) => a.tool === "exec" || a.tool === "bash");
  const writeActions = bundle.actions.filter(
    (a) => a.tool === "write" || a.tool === "edit" || a.tool === "apply_patch",
  );
  const readActions = bundle.actions.filter((a) => a.tool === "read" || a.tool === "glob");

  // Check exec actions against hard-deny patterns
  for (const action of execActions) {
    const command = typeof action.params.command === "string" ? action.params.command : "";

    for (const pattern of EXFIL_PATTERNS) {
      if (pattern.test(command)) {
        return hardDeny(`Potential data exfiltration in exec: ${pattern.source}`, "exfiltration");
      }
    }
    for (const pattern of ENV_SECRET_PATTERNS) {
      if (pattern.test(command)) {
        return hardDeny(`Potential secret access in exec: ${pattern.source}`, "secret_leakage");
      }
    }
    for (const pattern of DESTRUCTIVE_PATTERNS) {
      if (pattern.test(command)) {
        return hardDeny(`Destructive command: ${pattern.source}`, "destructive");
      }
    }
    for (const pattern of PRIVESC_PATTERNS) {
      if (pattern.test(command)) {
        return hardDeny(`Privilege escalation: ${pattern.source}`, "privesc");
      }
    }
  }

  // Check network targets
  if (bundle.networkTargets) {
    for (const target of bundle.networkTargets) {
      if (target.ip === "0.0.0.0" || target.domain === "0.0.0.0") {
        return hardDeny("Port exposure to 0.0.0.0 (all interfaces)", "port_exposure");
      }
    }
  }

  // Bundle-level: read sensitive + exec exfiltrate in same bundle
  const readsSensitive = readActions.some((a) => {
    const path = extractPath(a.params);
    return path && SENSITIVE_PATH_PATTERNS.some((p) => p.test(path));
  });
  const hasExfilExec = execActions.some((a) => {
    const cmd = typeof a.params.command === "string" ? a.params.command : "";
    return EXFIL_PATTERNS.some((p) => p.test(cmd));
  });

  if (readsSensitive && hasExfilExec) {
    return hardDeny("Read-sensitive + exec-exfiltrate chain detected", "exfiltration");
  }

  // Bundle-level: write to skills + exec in same bundle
  const writesToSkills = writeActions.some((a) => {
    const path = extractPath(a.params);
    return path && (/\.openclaw\/skills\//i.test(path) || /SKILL\.md$/i.test(path));
  });
  if (writesToSkills && execActions.length > 0) {
    // Not a hard deny, but will be flagged for LLM review with extra scrutiny
    // (LLM prompt mentions this explicitly)
  }

  return null; // passes rules engine
}

function hardDeny(reason: string, tag: string): SafeCheckResult {
  return {
    decision: "deny",
    summary: reason,
    risks: [reason],
    riskTags: [tag],
    confidence: 1.0,
    hardDenyRule: reason,
  };
}

function extractPath(params: Record<string, unknown>): string | undefined {
  const p = params.file_path ?? params.path ?? params.filePath ?? params.pattern;
  return typeof p === "string" ? p : undefined;
}

// ─── Claude API Review ───

async function reviewBundleWithClaude(params: {
  bundle: ActionBundle;
  apiKey: string;
  config: WaterModeConfig;
  logger?: Logger;
}): Promise<SafeCheckResult> {
  const { bundle, apiKey, config, logger } = params;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.safeCheckTimeoutMs);

  try {
    logger?.info(`SafeCheck reviewing bundle: ${bundle.goal.slice(0, 100)}`);

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: config.safeCheckModel,
        max_tokens: 512,
        system: buildSafeCheckSystemPrompt(),
        messages: [
          {
            role: "user",
            content: buildSafeCheckUserPrompt(bundle),
          },
        ],
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      logger?.error(`SafeCheck API error: ${response.status} ${body.slice(0, 200)}`);
      return DENY_RESULT;
    }

    const data = (await response.json()) as {
      content?: Array<{ type: string; text?: string }>;
    };
    const text = data.content?.find((c) => c.type === "text")?.text ?? "";

    return parseSafeCheckResponse(text, logger);
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      logger?.error(`SafeCheck timed out after ${config.safeCheckTimeoutMs}ms`);
    } else {
      logger?.error(`SafeCheck error: ${String(err)}`);
    }
    return DENY_RESULT;
  } finally {
    clearTimeout(timeout);
  }
}

function parseSafeCheckResponse(text: string, logger?: Logger): SafeCheckResult {
  try {
    const cleaned = text
      .replace(/^```(?:json)?\s*/m, "")
      .replace(/\s*```\s*$/m, "")
      .trim();
    const parsed = JSON.parse(cleaned) as Record<string, unknown>;

    const decision = parsed.decision;
    if (decision !== "approve" && decision !== "deny") {
      logger?.error(`SafeCheck: invalid decision "${String(decision)}", defaulting to deny`);
      return DENY_RESULT;
    }

    const confidence = typeof parsed.confidence === "number" ? parsed.confidence : 0;

    // Low confidence → deny
    if (decision === "approve" && confidence < 0.7) {
      logger?.info(`SafeCheck: approve with low confidence (${confidence}), downgrading to deny`);
      return {
        decision: "deny",
        summary: `Low confidence approval (${confidence}) — denied for safety`,
        risks: Array.isArray(parsed.risks) ? parsed.risks.map(String) : [],
        riskTags: Array.isArray(parsed.riskTags) ? parsed.riskTags.map(String) : [],
        confidence,
      };
    }

    return {
      decision,
      summary: typeof parsed.summary === "string" ? parsed.summary : "No summary",
      risks: Array.isArray(parsed.risks) ? parsed.risks.map(String) : [],
      riskTags: Array.isArray(parsed.riskTags) ? parsed.riskTags.map(String) : [],
      confidence,
    };
  } catch (err) {
    logger?.error(`SafeCheck: failed to parse response: ${String(err)}`);
    return DENY_RESULT;
  }
}
