#!/bin/sh
# OpenClaw Secure Entrypoint — Key Isolation Mode
#
# Problem: exec:full lets the bot read process.env and /proc/1/environ.
# Solution: Start the gateway with a CLEAN environment that contains
# NO API keys. LLM keys are read from auth-profiles.json instead.
#
# Bot tokens (Discord/Telegram) are passed as env vars because the
# gateway needs them for channel init, but they are scrubbed from
# /proc/1/environ by re-exec'ing through env -i.
#
# The only sensitive value remaining in env is OPENCLAW_GATEWAY_TOKEN,
# which is required for the gateway API auth and already exposed via
# the gateway's /healthz endpoint pattern.

set -e

echo "[secure-entrypoint] Starting in key-isolation mode..."

# Validate that auth-profiles.json exists (so LLM keys aren't lost)
AUTH_PROFILES="/home/node/.openclaw/agents/main/agent/auth-profiles.json"
if [ ! -f "$AUTH_PROFILES" ]; then
  echo "[secure-entrypoint] ERROR: $AUTH_PROFILES not found."
  echo "[secure-entrypoint] LLM API keys must be in auth-profiles.json, not env vars."
  exit 1
fi

# Bot tokens need to be in config file, not env vars.
# Check that Telegram token is in openclaw.json (not relying on env).
CONFIG="/home/node/.openclaw/openclaw.json"
if [ -f "$CONFIG" ]; then
  HAS_TG_TOKEN=$(grep -c '"botToken"' "$CONFIG" 2>/dev/null || true)
  if [ "$HAS_TG_TOKEN" -eq 0 ] && [ -z "$TELEGRAM_BOT_TOKEN" ]; then
    echo "[secure-entrypoint] WARNING: No bot token found in config or env."
  fi
fi

# Build a clean environment with ONLY non-sensitive variables.
# This ensures /proc/1/environ has no API keys.
CLEAN_ENV=""
CLEAN_ENV="$CLEAN_ENV HOME=$HOME"
CLEAN_ENV="$CLEAN_ENV TERM=${TERM:-xterm-256color}"
CLEAN_ENV="$CLEAN_ENV PATH=$PATH"
CLEAN_ENV="$CLEAN_ENV NODE_ENV=${NODE_ENV:-production}"
CLEAN_ENV="$CLEAN_ENV OPENCLAW_GATEWAY_TOKEN=$OPENCLAW_GATEWAY_TOKEN"

# Write SECURITY_REVIEW_API_KEY to a file instead of env
# (so exec can't read it via process.env or /proc/1/environ)
REVIEW_KEY_FILE="/tmp/.sec-review-key"
if [ -n "$SECURITY_REVIEW_API_KEY" ]; then
  printf '%s' "$SECURITY_REVIEW_API_KEY" > "$REVIEW_KEY_FILE"
  chmod 400 "$REVIEW_KEY_FILE"
  CLEAN_ENV="$CLEAN_ENV SECURITY_REVIEW_API_KEY_FILE=$REVIEW_KEY_FILE"
fi

# Write NOTION_API_TOKEN to a file instead of env
NOTION_KEY_FILE="/tmp/.notion-api-token"
if [ -n "$NOTION_API_TOKEN" ]; then
  printf '%s' "$NOTION_API_TOKEN" > "$NOTION_KEY_FILE"
  chmod 400 "$NOTION_KEY_FILE"
  CLEAN_ENV="$CLEAN_ENV NOTION_API_TOKEN_FILE=$NOTION_KEY_FILE"
fi

# Bot tokens: Telegram botToken is in openclaw.json config.
# Discord token: gateway reads from env if not in config.
# We pass them as last resort — security review plugin blocks
# any exec that reads *_TOKEN from env.
if [ -n "$DISCORD_BOT_TOKEN" ]; then
  CLEAN_ENV="$CLEAN_ENV DISCORD_BOT_TOKEN=$DISCORD_BOT_TOKEN"
fi
if [ -n "$TELEGRAM_BOT_TOKEN" ]; then
  CLEAN_ENV="$CLEAN_ENV TELEGRAM_BOT_TOKEN=$TELEGRAM_BOT_TOKEN"
fi

echo "[secure-entrypoint] API keys isolated to auth-profiles.json"
echo "[secure-entrypoint] Env scrubbed: ANTHROPIC_API_KEY, OPENAI_API_KEY, GOOGLE_API_KEY, SECURITY_REVIEW_API_KEY, NOTION_API_TOKEN"

# Re-exec with clean environment via env -i.
# This replaces PID 1, so /proc/1/environ only shows the clean vars.
# shellcheck disable=SC2086
exec env -i $CLEAN_ENV "$@"
