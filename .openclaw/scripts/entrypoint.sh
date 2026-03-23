#!/bin/sh
# OpenClaw Secure Entrypoint
# Decrypts API keys from encrypted file and passes them ONLY to the gateway
# child process — they never appear in the shell environment or `env` output.
#
# Encryption: AES-256-CBC with key derived from OPENCLAW_GATEWAY_TOKEN
# The gateway token is already required, so no extra secret is needed.

set -e

SECRETS_FILE="/home/node/.openclaw/secrets.enc"
SECRETS_KEY_ENV="OPENCLAW_GATEWAY_TOKEN"

if [ ! -f "$SECRETS_FILE" ]; then
  echo "[entrypoint] No encrypted secrets file found, using environment variables as-is."
  exec "$@"
fi

# Derive AES key from gateway token (SHA-256 of token = 32 bytes)
KEY_HEX=$(printf '%s' "$OPENCLAW_GATEWAY_TOKEN" | openssl dgst -sha256 -hex 2>/dev/null | awk '{print $NF}')

if [ -z "$KEY_HEX" ]; then
  echo "[entrypoint] ERROR: Cannot derive decryption key. Is OPENCLAW_GATEWAY_TOKEN set?"
  exit 1
fi

# Decrypt secrets file (format: KEY=VALUE per line, encrypted with AES-256-CBC)
DECRYPTED=$(openssl enc -aes-256-cbc -d -pbkdf2 -iter 100000 \
  -pass "pass:${KEY_HEX}" \
  -in "$SECRETS_FILE" 2>/dev/null)

if [ $? -ne 0 ] || [ -z "$DECRYPTED" ]; then
  echo "[entrypoint] ERROR: Failed to decrypt secrets. Wrong token or corrupted file."
  exit 1
fi

# Export decrypted variables ONLY for this process tree
# They won't appear in a new shell's `env` since we use exec
eval "$(echo "$DECRYPTED" | sed 's/^/export /')"

echo "[entrypoint] Secrets decrypted and loaded. Starting gateway..."

# Replace this process with the actual command
exec "$@"
