---
description: Start/manage OpenClaw (🥜) service on a configured device
allowed-tools: Bash, Read, AskUserQuestion
---

You are managing OpenClaw (🥜) — a personal AI assistant running in a hardened Docker container.
All config lives at `~/.openclaw-docker/`.

## Determine Action

If `$ARGUMENTS` is provided, parse the action from it. Supported actions:
- (empty / "start" / "up") — Start the gateway
- "stop" / "down" — Stop the gateway
- "restart" — Restart the gateway
- "status" — Show status and health
- "logs" — Tail recent logs
- "logs follow" / "logs -f" — Follow logs in real-time
- "approve" — List and approve pending device pairing requests
- "shell" — Open a CLI chat session
- "update" — Rebuild image from source and restart
- "check" — Run security verification checks
- "token" — Display the current gateway token
- "rotate" — Rotate the gateway token
- "backup" — Backup config and workspace

If no argument, default to "start".

## Pre-flight

1. Verify `~/.openclaw-docker/docker-compose.yml` exists. If not, tell the user to run `/openclaw_setup` first.
2. Verify Docker is running: `docker info --format '{{.ServerVersion}}'`

## Actions

### start / up

```bash
cd ~/.openclaw-docker && docker compose up -d openclaw-gateway
```

Wait 8 seconds, then verify:
```bash
docker ps --filter name=openclaw-gateway --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"
curl -sf http://127.0.0.1:18789/healthz > /dev/null && echo "🥜 Health: OK" || echo "🥜 Health: FAIL"
```

If health fails, show last 20 lines of logs.

### stop / down

```bash
cd ~/.openclaw-docker && docker compose down
```

### restart

```bash
cd ~/.openclaw-docker && docker compose restart openclaw-gateway
```

Wait 8 seconds, then verify health.

### status

```bash
# Container status
docker ps --filter name=openclaw-gateway --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"

# Health
curl -sf http://127.0.0.1:18789/healthz > /dev/null && echo "🥜 Health: OK" || echo "🥜 Health: FAIL"

# Uptime and resource usage
docker stats openclaw-docker-openclaw-gateway-1 --no-stream --format "CPU: {{.CPUPerc}}  Memory: {{.MemUsage}}"
```

### logs / logs follow

```bash
# Recent logs
docker logs openclaw-docker-openclaw-gateway-1 --tail 50

# Or follow mode
docker logs -f openclaw-docker-openclaw-gateway-1
```

### approve

```bash
docker exec openclaw-docker-openclaw-gateway-1 node dist/index.js devices list
```

If there are pending requests, show them and ask the user which to approve:
```bash
docker exec openclaw-docker-openclaw-gateway-1 node dist/index.js devices approve <request-id>
```

### shell

```bash
cd ~/.openclaw-docker && docker compose run --rm openclaw-cli chat
```

### update

Ask user for the source repo path (default: `~/Documents/GitHub/openclaw`).

```bash
cd <repo-path> && git pull && docker build -t openclaw:local .
cd ~/.openclaw-docker && docker compose down && docker compose up -d openclaw-gateway
```

Wait and verify health.

### check

Run the comprehensive security audit. This delegates to `/openclaw_check` for full coverage.

Tell the user: "For a full security audit, use `/openclaw_check`. Running quick health check..."

Quick checks:
```bash
# Container running?
docker ps --filter name=openclaw-gateway --format "{{.Names}}\t{{.Status}}" | head -1

# Health
curl -sf http://127.0.0.1:18789/healthz > /dev/null && echo "🥜 Health: OK" || echo "🥜 Health: FAIL"

# Auth enforced?
curl -sf http://127.0.0.1:18789/api/status && echo "🥜 Auth: FAIL (no auth required)" || echo "🥜 Auth: OK (requires token)"

# Port binding safe?
docker port openclaw-docker-openclaw-gateway-1 | grep -v 127.0.0.1 && echo "🥜 Ports: FAIL (exposed)" || echo "🥜 Ports: OK (localhost only)"
```

For the full 20+ item audit, recommend `/openclaw_check`.

### token

```bash
grep OPENCLAW_GATEWAY_TOKEN ~/.openclaw-docker/.env | cut -d= -f2
```

### rotate

```bash
NEW_TOKEN=$(openssl rand -hex 32)
echo "New token: $NEW_TOKEN"
```

Then update both `.env` and `openclaw.json` with the new token, restart the container, and remind the user they need to re-pair their browser.

### backup

```bash
BACKUP_FILE=~/openclaw-backup-$(date +%Y%m%d-%H%M%S).tar.gz
tar czf "$BACKUP_FILE" -C ~ .openclaw-docker/config .openclaw-docker/workspace .openclaw-docker/.env .openclaw-docker/docker-compose.yml
chmod 600 "$BACKUP_FILE"
echo "Backup saved to $BACKUP_FILE"
```

## Output Style

- Use 🥜 emoji as prefix for status messages
- Keep output concise
- Always end with the current state (running/stopped/error)
