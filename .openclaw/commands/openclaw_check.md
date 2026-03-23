---
description: Run comprehensive security audit of OpenClaw (🥜) Docker deployment
allowed-tools: Bash, Read, AskUserQuestion, TodoWrite
---

You are auditing the security of OpenClaw (🥜) — a personal AI assistant running in a hardened Docker container.

Run ALL checks below, collect results, then output a single summary report.

## Pre-flight

1. Verify the container is running:
   ```bash
   docker ps --filter name=openclaw-gateway --format "{{.Names}}" | grep -q openclaw-gateway
   ```
   If not running, report "Container not running" and stop.

2. Set variables:
   ```
   CONTAINER=openclaw-docker-openclaw-gateway-1
   CONFIG_DIR=~/.openclaw-docker/config
   ENV_FILE=~/.openclaw-docker/.env
   CONFIG_FILE=$CONFIG_DIR/openclaw.json
   ```

## Checks

### 1. Port Security

**1.1 Port Binding Address**
```bash
docker port $CONTAINER
```
PASS if ALL ports show `127.0.0.1:*`. FAIL if any show `0.0.0.0`.

**1.2 API Authentication Enforcement**
```bash
curl -sf http://127.0.0.1:18789/api/status
```
PASS if curl returns non-zero (request rejected). FAIL if it succeeds without auth.

**1.3 Allowed Origins**
Read `$CONFIG_FILE` and check `gateway.controlUi.allowedOrigins`.
PASS if only contains `localhost` or `127.0.0.1` origins. FAIL if contains external IPs/domains.

### 2. Container Security

**2.1 Non-root User**
```bash
docker inspect $CONTAINER --format '{{.Config.User}}'
```
PASS if non-empty and not "root" / "0".

**2.2 Read-only Root Filesystem**
```bash
docker inspect $CONTAINER --format '{{.HostConfig.ReadonlyRootfs}}'
```
PASS if `true`.

**2.3 Non-privileged Mode**
```bash
docker inspect $CONTAINER --format '{{.HostConfig.Privileged}}'
```
PASS if `false`.

**2.4 Capabilities**
```bash
docker inspect $CONTAINER --format 'CapDrop:{{.HostConfig.CapDrop}} CapAdd:{{.HostConfig.CapAdd}}'
```
PASS if CapDrop contains `ALL` and CapAdd only contains `NET_BIND_SERVICE` (or is empty).

**2.5 No New Privileges**
```bash
docker inspect $CONTAINER --format '{{.HostConfig.SecurityOpt}}'
```
PASS if contains `no-new-privileges:true` or `no-new-privileges`.

**2.6 Sensitive File Permissions**
```bash
stat -f '%Sp %N' $ENV_FILE $CONFIG_FILE 2>/dev/null || stat -c '%A %n' $ENV_FILE $CONFIG_FILE
```
PASS if both are `-rw-------` (600). FAIL if group/other readable.

### 3. OpenClaw Permission Configuration

Read `$CONFIG_FILE` with the Read tool and check these fields:

**3.1 Tool Profile**
PASS if `tools.profile` is `"messaging"`. WARN if different (note what it is).

**3.2 Command Execution**
PASS if `tools.exec.security` is `"deny"` or `"allowlist"`. FAIL if `"full"`.

**3.3 Filesystem Scope**
PASS if `tools.fs.workspaceOnly` is `true`. FAIL if `false` or missing.

**3.4 Elevated Permissions**
PASS if `tools.elevated.enabled` is `false`. FAIL if `true`.

**3.5 Denied Tool Groups**
PASS if `tools.deny` includes `"group:automation"`, `"group:runtime"`, and `"sessions_spawn"`. WARN if any missing.

**3.6 Config Writes**
For each channel (telegram, discord, etc.): PASS if `configWrites` is `false` or absent. FAIL if `true`.

**3.7 DM Policy**
For each channel: PASS if `dmPolicy` is `"pairing"`. WARN if `"open"`.

**3.8 Group Policy**
For each channel: PASS if `groupPolicy` is `"allowlist"`. WARN if `"open"`.

**3.9 Sensitive Log Redaction**
PASS if `logging.redactSensitive` is `"tools"`. WARN if `"off"`.

**3.10 Gateway Authentication**
PASS if `gateway.auth.mode` is `"token"` AND `gateway.auth.token` is >= 64 hex characters. FAIL otherwise.

### 4. Information Items (non-pass/fail)

**4.1 memory_read/write** — Check if these are in `tools.alsoAllow` but plugin not enabled. Report as INFO.

**4.2 Bot Token in Config** — Check if any `botToken` field exists in channel configs. Report as INFO with note about file permission protection.

**4.3 Gateway Bind** — Report `gateway.bind` value. INFO: explain that "lan" inside container is normal because docker-compose restricts host-side to 127.0.0.1.

**4.4 Exec Allowlist** — If exec.security is "allowlist", list what's in the allowlist. INFO.

## Output Format

After running all checks, output a structured report:

```
🥜 OpenClaw Security Audit Report
══════════════════════════════════

## 1. Port Security

| # | Check              | Result | Detail                          |
|---|---------------------|--------|---------------------------------|
| 1 | Port binding        | PASS   | All ports on 127.0.0.1          |
| 2 | API auth            | PASS   | Unauthenticated requests denied |
| 3 | Allowed origins     | PASS   | localhost/127.0.0.1 only        |

## 2. Container Security
... (same table format)

## 3. Permission Configuration
... (same table format)

## 4. Information
... (INFO items as bullet list)

## Summary
X/Y checks passed, Z warnings, W failures.
Overall: SECURE / ATTENTION NEEDED / INSECURE
```

If any FAIL is found, highlight it prominently and suggest remediation steps.
