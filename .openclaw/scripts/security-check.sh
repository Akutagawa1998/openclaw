#!/bin/sh
# OpenClaw Container Security Self-Check
# This script runs INSIDE the container and checks what it can access.
# Output: JSON report to stdout
# Exit: 0 always (report contains pass/fail details)
#
# Usage: /home/node/.openclaw/scripts/security-check.sh
# Allowlisted for bot exec — read-only, no side effects.

set -e

CONFIG="/home/node/.openclaw/openclaw.json"
RESULTS=""
PASS_COUNT=0
FAIL_COUNT=0
WARN_COUNT=0

# Helper: add a check result
add_result() {
  local category="$1" name="$2" status="$3" detail="$4"
  if [ -n "$RESULTS" ]; then
    RESULTS="${RESULTS},"
  fi
  RESULTS="${RESULTS}{\"category\":\"${category}\",\"name\":\"${name}\",\"status\":\"${status}\",\"detail\":\"${detail}\"}"
  case "$status" in
    PASS) PASS_COUNT=$((PASS_COUNT + 1)) ;;
    FAIL) FAIL_COUNT=$((FAIL_COUNT + 1)) ;;
    WARN) WARN_COUNT=$((WARN_COUNT + 1)) ;;
  esac
}

# Helper: read JSON field (basic jq-free parser for simple paths)
json_val() {
  local file="$1" path="$2"
  # Use node if available (we're in a node container), fallback to grep
  if command -v node >/dev/null 2>&1; then
    node -e "
      const fs = require('fs');
      try {
        const obj = JSON.parse(fs.readFileSync('${file}', 'utf8'));
        const val = '${path}'.split('.').reduce((o,k) => o && o[k], obj);
        if (val === undefined) process.stdout.write('__UNDEFINED__');
        else if (typeof val === 'object') process.stdout.write(JSON.stringify(val));
        else process.stdout.write(String(val));
      } catch(e) { process.stdout.write('__ERROR__'); }
    " 2>/dev/null
  else
    echo "__NO_NODE__"
  fi
}

# ─── Check: Process User ───
CURRENT_USER=$(whoami 2>/dev/null || id -un 2>/dev/null || echo "unknown")
if [ "$CURRENT_USER" != "root" ] && [ "$CURRENT_USER" != "0" ]; then
  add_result "container" "process_user" "PASS" "Running as: ${CURRENT_USER}"
else
  add_result "container" "process_user" "FAIL" "Running as root!"
fi

# ─── Check: Config file exists and readable ───
if [ -f "$CONFIG" ]; then
  add_result "config" "config_exists" "PASS" "Config file found"
else
  add_result "config" "config_exists" "FAIL" "Config file not found at ${CONFIG}"
  # Output minimal report and exit
  printf '{"timestamp":"%s","results":[%s],"summary":{"pass":%d,"fail":%d,"warn":%d}}\n' \
    "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$RESULTS" "$PASS_COUNT" "$FAIL_COUNT" "$WARN_COUNT"
  exit 0
fi

# ─── Check: tools.profile ───
PROFILE=$(json_val "$CONFIG" "tools.profile")
if [ "$PROFILE" = "messaging" ]; then
  add_result "permissions" "tool_profile" "PASS" "Profile: messaging (minimal)"
elif [ "$PROFILE" = "__UNDEFINED__" ]; then
  add_result "permissions" "tool_profile" "WARN" "Profile not set (using default)"
else
  add_result "permissions" "tool_profile" "WARN" "Profile: ${PROFILE} (not messaging)"
fi

# ─── Check: tools.exec.security ───
EXEC_SEC=$(json_val "$CONFIG" "tools.exec.security")
if [ "$EXEC_SEC" = "deny" ]; then
  add_result "permissions" "exec_security" "PASS" "Exec: deny (all commands blocked)"
elif [ "$EXEC_SEC" = "allowlist" ]; then
  add_result "permissions" "exec_security" "PASS" "Exec: allowlist (restricted commands only)"
elif [ "$EXEC_SEC" = "full" ]; then
  add_result "permissions" "exec_security" "FAIL" "Exec: full (all commands allowed!)"
else
  add_result "permissions" "exec_security" "WARN" "Exec security: ${EXEC_SEC}"
fi

# ─── Check: tools.fs.workspaceOnly ───
WS_ONLY=$(json_val "$CONFIG" "tools.fs.workspaceOnly")
if [ "$WS_ONLY" = "true" ]; then
  add_result "permissions" "fs_workspace_only" "PASS" "Filesystem restricted to workspace"
else
  add_result "permissions" "fs_workspace_only" "FAIL" "Filesystem NOT restricted to workspace"
fi

# ─── Check: tools.elevated.enabled ───
ELEVATED=$(json_val "$CONFIG" "tools.elevated.enabled")
if [ "$ELEVATED" = "false" ]; then
  add_result "permissions" "elevated_disabled" "PASS" "Elevated permissions disabled"
elif [ "$ELEVATED" = "__UNDEFINED__" ]; then
  add_result "permissions" "elevated_disabled" "PASS" "Elevated not configured (default off)"
else
  add_result "permissions" "elevated_disabled" "FAIL" "Elevated permissions ENABLED"
fi

# ─── Check: tools.deny groups ───
DENY_LIST=$(json_val "$CONFIG" "tools.deny")
HAS_AUTOMATION=$(echo "$DENY_LIST" | grep -c "group:automation" || true)
HAS_SESSIONS=$(echo "$DENY_LIST" | grep -c "sessions_spawn" || true)
# group:runtime OR individual "process" deny — both are valid
# (group:runtime blocks exec+process; individual "process" allows exec via allowlist)
HAS_RUNTIME_OR_PROCESS=$(echo "$DENY_LIST" | grep -cE "group:runtime|\"process\"" || true)
if [ "$HAS_AUTOMATION" -gt 0 ] && [ "$HAS_RUNTIME_OR_PROCESS" -gt 0 ] && [ "$HAS_SESSIONS" -gt 0 ]; then
  add_result "permissions" "deny_groups" "PASS" "Denied: automation, process/runtime, sessions_spawn"
else
  MISSING=""
  [ "$HAS_AUTOMATION" -eq 0 ] && MISSING="${MISSING}group:automation "
  [ "$HAS_RUNTIME_OR_PROCESS" -eq 0 ] && MISSING="${MISSING}group:runtime-or-process "
  [ "$HAS_SESSIONS" -eq 0 ] && MISSING="${MISSING}sessions_spawn "
  add_result "permissions" "deny_groups" "WARN" "Missing deny entries: ${MISSING}"
fi

# ─── Check: logging.redactSensitive ───
REDACT=$(json_val "$CONFIG" "logging.redactSensitive")
if [ "$REDACT" = "tools" ]; then
  add_result "permissions" "log_redaction" "PASS" "Sensitive data redacted in tool output"
elif [ "$REDACT" = "off" ]; then
  add_result "permissions" "log_redaction" "WARN" "Log redaction is OFF"
else
  add_result "permissions" "log_redaction" "WARN" "Log redaction: ${REDACT}"
fi

# ─── Check: gateway.auth ───
AUTH_MODE=$(json_val "$CONFIG" "gateway.auth.mode")
AUTH_TOKEN=$(json_val "$CONFIG" "gateway.auth.token")
TOKEN_LEN=${#AUTH_TOKEN}
if [ "$AUTH_MODE" = "token" ] && [ "$TOKEN_LEN" -ge 64 ]; then
  add_result "gateway" "auth_token" "PASS" "Token auth enabled (${TOKEN_LEN} char token)"
elif [ "$AUTH_MODE" = "token" ] && [ "$TOKEN_LEN" -lt 64 ]; then
  add_result "gateway" "auth_token" "WARN" "Token too short (${TOKEN_LEN} chars, recommend >= 64)"
else
  add_result "gateway" "auth_token" "FAIL" "Auth mode: ${AUTH_MODE} (expected: token)"
fi

# ─── Check: Channel security (iterate known channels) ───
for CHANNEL in telegram discord; do
  ENABLED=$(json_val "$CONFIG" "channels.${CHANNEL}.enabled")
  if [ "$ENABLED" != "true" ]; then
    continue
  fi

  DM_POLICY=$(json_val "$CONFIG" "channels.${CHANNEL}.dmPolicy")
  if [ "$DM_POLICY" = "pairing" ]; then
    add_result "channels" "${CHANNEL}_dm_policy" "PASS" "${CHANNEL}: DM requires pairing"
  elif [ "$DM_POLICY" = "open" ]; then
    add_result "channels" "${CHANNEL}_dm_policy" "WARN" "${CHANNEL}: DM is open (no pairing)"
  else
    add_result "channels" "${CHANNEL}_dm_policy" "INFO" "${CHANNEL}: dmPolicy=${DM_POLICY}"
  fi

  GROUP_POLICY=$(json_val "$CONFIG" "channels.${CHANNEL}.groupPolicy")
  if [ "$GROUP_POLICY" = "allowlist" ]; then
    add_result "channels" "${CHANNEL}_group_policy" "PASS" "${CHANNEL}: Groups use allowlist"
  elif [ "$GROUP_POLICY" = "open" ]; then
    add_result "channels" "${CHANNEL}_group_policy" "WARN" "${CHANNEL}: Groups are open"
  else
    add_result "channels" "${CHANNEL}_group_policy" "INFO" "${CHANNEL}: groupPolicy=${GROUP_POLICY}"
  fi

  CONFIG_WRITES=$(json_val "$CONFIG" "channels.${CHANNEL}.configWrites")
  if [ "$CONFIG_WRITES" = "true" ]; then
    add_result "channels" "${CHANNEL}_config_writes" "FAIL" "${CHANNEL}: Bot can modify its own config!"
  else
    add_result "channels" "${CHANNEL}_config_writes" "PASS" "${CHANNEL}: Config writes disabled"
  fi
done

# ─── Check: allowedOrigins ───
ORIGINS_SAFE=$(node -e "
  const fs = require('fs');
  try {
    const cfg = JSON.parse(fs.readFileSync('${CONFIG}', 'utf8'));
    const origins = cfg.gateway?.controlUi?.allowedOrigins || [];
    const unsafe = origins.filter(o => {
      try {
        const u = new URL(o);
        return u.hostname !== 'localhost' && u.hostname !== '127.0.0.1';
      } catch { return true; }
    });
    process.stdout.write(unsafe.length === 0 ? 'safe' : 'unsafe:' + unsafe.join(','));
  } catch(e) { process.stdout.write('error'); }
" 2>/dev/null)
if [ "$ORIGINS_SAFE" = "safe" ]; then
  add_result "gateway" "allowed_origins" "PASS" "Origins restricted to localhost"
elif [ "$ORIGINS_SAFE" = "error" ]; then
  add_result "gateway" "allowed_origins" "WARN" "Could not parse allowedOrigins"
else
  add_result "gateway" "allowed_origins" "WARN" "Non-local origins found: ${ORIGINS_SAFE#unsafe:}"
fi

# ─── Info: gateway.bind ───
GW_BIND=$(json_val "$CONFIG" "gateway.bind")
add_result "info" "gateway_bind" "INFO" "gateway.bind=${GW_BIND} (inside container; host restricts via docker port mapping)"

# ─── Info: botToken in config ───
HAS_BOT_TOKEN=$(grep -c '"botToken"' "$CONFIG" 2>/dev/null || true)
if [ "$HAS_BOT_TOKEN" -gt 0 ]; then
  add_result "info" "bot_token_in_config" "INFO" "Bot token(s) present in config (protected by file permissions)"
fi

# ─── Info: memory tools ───
ALSO_ALLOW=$(json_val "$CONFIG" "tools.alsoAllow")
HAS_MEMORY=$(echo "$ALSO_ALLOW" | grep -c "memory_" || true)
if [ "$HAS_MEMORY" -gt 0 ]; then
  add_result "info" "memory_tools" "INFO" "memory_read/write in alsoAllow (no effect unless plugin enabled)"
fi

# ─── Docker-level checks marker ───
add_result "info" "docker_checks" "INFO" "Port binding, rootfs, capabilities, privileges require host-level check (/openclaw_check)"

# ─── Output JSON ───
printf '{"timestamp":"%s","results":[%s],"summary":{"pass":%d,"fail":%d,"warn":%d,"total":%d}}\n' \
  "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  "$RESULTS" \
  "$PASS_COUNT" "$FAIL_COUNT" "$WARN_COUNT" \
  "$((PASS_COUNT + FAIL_COUNT + WARN_COUNT))"
