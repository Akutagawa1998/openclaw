---
name: model-status
description: Check model connectivity and auth status for all configured providers. Use when the user asks to check model status, test API keys, probe model connectivity, or diagnose provider issues.
---

# Model Status Check

## Overview

Probe and report the connectivity status of all configured AI model providers. This skill runs `openclaw models status --probe` to test each provider's API key and endpoint, then presents results in a clear summary.

## Workflow

### 1) Run status probe

Run the following command to get full model status with connectivity probes:

```bash
openclaw models status --probe
```

If the gateway is running in Docker, run inside the container:

```bash
docker exec openclaw-gateway node dist/index.js models status --probe
```

If `--probe` is not supported or errors, fall back to:

```bash
openclaw models status
```

### 2) Parse and present results

Summarize the output for the user:

- For each provider/profile, report:
  - Provider name and model
  - Auth status (valid / expired / missing)
  - Connectivity (reachable / unreachable / timeout)
  - Latency (if probe succeeded)
  - Any errors or warnings

Format as a compact table or list. Use emoji indicators:
- Working: `model (provider) — latency`
- Degraded: `model (provider) — auth issue / warning`
- Down: `model (provider) — error details`

### 3) Recommendations

If any provider is failing:
- Suggest `/model provider/model` to switch to a working provider
- If billing error, suggest checking the provider's billing dashboard
- If auth error, suggest updating the auth profile via `openclaw models auth`

## Additional commands

If the user wants deeper diagnostics:

```bash
# JSON output for programmatic use
openclaw models status --probe --json

# Check specific provider only
openclaw models status --probe --probe-provider <provider>

# Full system health
openclaw doctor
```

## Notes

- This skill is read-only; it does not modify any configuration.
- Probe results reflect real-time connectivity and may vary with network conditions.
- API key validity is checked by making a minimal API call to each provider.
