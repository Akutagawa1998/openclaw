#!/bin/sh
# Encrypt API keys for OpenClaw secure deployment
# Usage: ./encrypt-secrets.sh
#
# Reads ~/.openclaw-docker/.env, extracts API keys,
# encrypts them with the gateway token, and outputs secrets.enc
#
# After encryption, API key env vars can be REMOVED from docker-compose.yml
# The entrypoint.sh will decrypt them at container startup.

set -e

ENV_FILE="${HOME}/.openclaw-docker/.env"
CONFIG_DIR="${HOME}/.openclaw-docker/config"
OUTPUT_FILE="${CONFIG_DIR}/secrets.enc"

if [ ! -f "$ENV_FILE" ]; then
  echo "ERROR: $ENV_FILE not found"
  exit 1
fi

# Read gateway token
TOKEN=$(grep '^OPENCLAW_GATEWAY_TOKEN=' "$ENV_FILE" | cut -d= -f2)
if [ -z "$TOKEN" ]; then
  echo "ERROR: OPENCLAW_GATEWAY_TOKEN not found in $ENV_FILE"
  exit 1
fi

# Derive encryption key (same as entrypoint.sh)
KEY_HEX=$(printf '%s' "$TOKEN" | openssl dgst -sha256 -hex 2>/dev/null | awk '{print $NF}')

# Extract only API key lines (the secrets we want to protect)
SECRETS=$(grep -E '^(ANTHROPIC_API_KEY|OPENAI_API_KEY|GOOGLE_API_KEY|DISCORD_BOT_TOKEN|TELEGRAM_BOT_TOKEN)=' "$ENV_FILE")

if [ -z "$SECRETS" ]; then
  echo "ERROR: No API keys found in $ENV_FILE"
  exit 1
fi

# Count keys
KEY_COUNT=$(echo "$SECRETS" | wc -l | tr -d ' ')
echo "Found $KEY_COUNT secret(s) to encrypt:"
echo "$SECRETS" | sed 's/=.*/=***/'

# Encrypt
echo "$SECRETS" | openssl enc -aes-256-cbc -pbkdf2 -iter 100000 \
  -pass "pass:${KEY_HEX}" \
  -out "$OUTPUT_FILE"

chmod 600 "$OUTPUT_FILE"

echo ""
echo "Encrypted secrets saved to: $OUTPUT_FILE"
echo "Encryption key: derived from OPENCLAW_GATEWAY_TOKEN (SHA-256)"
echo ""
echo "Next steps:"
echo "  1. Remove API key env vars from docker-compose.yml (keep only OPENCLAW_GATEWAY_TOKEN)"
echo "  2. Restart container: cd ~/.openclaw-docker && docker compose down && docker compose up -d"
echo ""
echo "To verify decryption works:"
echo "  openssl enc -aes-256-cbc -d -pbkdf2 -iter 100000 -pass pass:${KEY_HEX} -in $OUTPUT_FILE"
