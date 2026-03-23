---
description: One-click setup of OpenClaw (🥜) Docker deployment on a new device
allowed-tools: Bash, Read, Write, Edit, AskUserQuestion, Agent, TodoWrite
---

You are setting up OpenClaw (🥜) — a personal AI assistant running in a hardened Docker container.

Follow these steps precisely. Stop and report if any step fails.

## Locate the Repo

The repo contains all templates at `.openclaw/`. Find it by checking these paths in order:
1. `~/Documents/GitHub/openclaw`
2. `~/openclaw`
3. Current working directory (check for `.openclaw/` directory)

If not found, ask the user for the repo path, or offer to clone from `https://github.com/openclaw/openclaw`.

Save the repo path as `REPO_PATH` for all subsequent steps.

## Pre-flight Checks

1. Verify Docker is installed and running:
   ```
   docker --version
   docker info --format '{{.ServerVersion}}'
   ```
   If Docker is not available, stop and tell the user to install Docker first.

2. Check if `~/.openclaw-docker/` already exists. If it does, ask the user whether to:
   - Overwrite (backup existing first via `tar czf ~/openclaw-backup-$(date +%Y%m%d-%H%M%S).tar.gz -C ~ .openclaw-docker/`)
   - Abort

3. Verify the repo has the template files:
   ```
   ls $REPO_PATH/.openclaw/.env.example
   ls $REPO_PATH/.openclaw/openclaw.json.template
   ls $REPO_PATH/.openclaw/docker-compose.yml
   ```

## Setup Steps

### Step 1: Build Docker Image

```bash
cd $REPO_PATH
docker build -t openclaw:local .
```

This takes ~5 minutes. Run in background if possible.

### Step 2: Create Directory Structure

```bash
mkdir -p ~/.openclaw-docker/config ~/.openclaw-docker/workspace
chmod 700 ~/.openclaw-docker ~/.openclaw-docker/config ~/.openclaw-docker/workspace
```

### Step 3: Generate Secure Token

```bash
TOKEN=$(openssl rand -hex 32)
```

Save this token for the next steps.

### Step 4: Copy Templates from Repo

Copy the docker-compose.yml from the repo (it contains NO secrets, only `${VAR}` references):
```bash
cp $REPO_PATH/.openclaw/docker-compose.yml ~/.openclaw-docker/docker-compose.yml
```

Copy the README:
```bash
cp $REPO_PATH/.openclaw/README.md ~/.openclaw-docker/README.md
```

### Step 5: Create .env from Template

Read `$REPO_PATH/.openclaw/.env.example` and create `~/.openclaw-docker/.env` based on it.

Replace:
- `GENERATE_WITH_openssl_rand_-hex_32` → the token from Step 3
- `REPLACE_WITH_HOME` → the user's actual home directory path
- Leave `REPLACE_ME` as-is for API keys

Then tell the user to edit the file manually to fill in their API keys.
NEVER write actual API keys yourself.

Ask the user which model providers they want to configure (multi-select):
- Anthropic (ANTHROPIC_API_KEY)
- OpenAI (OPENAI_API_KEY)
- Google (GOOGLE_API_KEY)

After user confirms they've edited it: `chmod 600 ~/.openclaw-docker/.env`

### Step 6: Create Hardened Configuration

Read `$REPO_PATH/.openclaw/openclaw.json.template` and create `~/.openclaw-docker/config/openclaw.json` based on it.

Replace `GENERATE_WITH_openssl_rand_-hex_32` with the same token from Step 3.

Then: `chmod 600 ~/.openclaw-docker/config/openclaw.json`

### Step 7: Set Up Claude Code Commands (symlinks)

```bash
mkdir -p ~/.claude/commands
ln -sf $REPO_PATH/.openclaw/commands/openclaw_setup.md ~/.claude/commands/openclaw_setup.md
ln -sf $REPO_PATH/.openclaw/commands/openclaw_run.md ~/.claude/commands/openclaw_run.md
```

### Step 8: Start and Verify

```bash
cd ~/.openclaw-docker
docker compose up -d openclaw-gateway
sleep 8
docker ps --filter name=openclaw-gateway
curl -sf http://127.0.0.1:18789/healthz > /dev/null && echo "Health OK" || echo "Health FAIL"
```

### Step 9: Security Verification

Run all these checks and report results:
```bash
# Port binding — must show 127.0.0.1
docker port openclaw-docker-openclaw-gateway-1

# Container hardening
docker inspect openclaw-docker-openclaw-gateway-1 --format 'User:{{.Config.User}} ReadOnly:{{.HostConfig.ReadonlyRootfs}} Privileged:{{.HostConfig.Privileged}} CapDrop:{{.HostConfig.CapDrop}} SecurityOpt:{{.HostConfig.SecurityOpt}}'

# Auth enforcement
curl -sf http://127.0.0.1:18789/api/status && echo "FAIL: no auth" || echo "OK: auth required"

# File permissions
ls -la ~/.openclaw-docker/.env ~/.openclaw-docker/config/openclaw.json
```

### Step 10: Device Pairing

Tell the user to open `http://127.0.0.1:18789` in their browser, then:
```bash
docker exec openclaw-docker-openclaw-gateway-1 node dist/index.js devices list
```

If there's a pending request, ask user to confirm, then approve it:
```bash
docker exec openclaw-docker-openclaw-gateway-1 node dist/index.js devices approve <request-id>
```

## Completion

Print a summary table of all security checks (pass/fail) and the access URL.
Remind the user their gateway token is in `~/.openclaw-docker/.env`.
