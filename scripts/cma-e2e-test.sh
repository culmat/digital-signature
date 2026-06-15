#!/usr/bin/env bash
set -euo pipefail

# ─────────────────────────────────────────────────────────────────────────────
# Repeatable end-to-end CMA migration test orchestrator.
#
# Drives a full Server→Cloud signature-data migration and verifies the result in
# the Forge DEVELOPMENT installation. Infra/state phases run here; the
# browser-driven phases are delegated to e2e/tests/cma-migration.spec.js
# (one Playwright invocation per phase, selected via CMA_PHASE).
#
# See docs/cma-migration-e2e.md for the full runbook and prerequisites.
#
# Usage:
#   scripts/cma-e2e-test.sh all          # full sequence
#   scripts/cma-e2e-test.sh <phase>      # single phase
#   phases: preflight reset server-up fixtures darkon migrate darkoff wizard verify
#
# Key env (most read from e2e/.env):
#   SERVER_BASE_URL          local Server URL (default http://localhost:9090)
#   CONFLUENCE_VERSION       Docker Confluence version (default 9.5.4)
#   LEGACY_DIR               path to digital-signature-legacy (default ../digital-signature-legacy)
#   FORGE_DEV_ENV            forge environment name (default development)
#   MIGRATION_SPACE_PREFIX   space-key prefix per run (default CMA)
#   CMA_AUTOMATE_MIGRATE=1   attempt to drive the CMA wizard (default: attempt, fall back to manual)
#   CMA_MANUAL_MIGRATE=1     force the manual migration checkpoint
# ─────────────────────────────────────────────────────────────────────────────

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# Load e2e/.env if present (CONFLUENCE_HOST, FORGE_ENV_ID, FORGE_*, SERVER_*, …).
ENV_FILE="$REPO_DIR/e2e/.env"
if [ -f "$ENV_FILE" ]; then
  set -a; # shellcheck disable=SC1090
  . "$ENV_FILE"; set +a
fi

SERVER_BASE_URL="${SERVER_BASE_URL:-http://localhost:9090}"
CONFLUENCE_VERSION="${CONFLUENCE_VERSION:-9.5.4}"
LEGACY_DIR="${LEGACY_DIR:-$REPO_DIR/../digital-signature-legacy}"
FORGE_DEV_ENV="${FORGE_DEV_ENV:-development}"
MIGRATION_SPACE_PREFIX="${MIGRATION_SPACE_PREFIX:-CMA}"
CDP_ENDPOINT="${CDP_ENDPOINT:-http://localhost:9222}"

STATE_FILE="${TMPDIR:-/tmp}/ds-cma-e2e-state.env"
ARTIFACT_DIR="$REPO_DIR/e2e/.cma-artifacts"
mkdir -p "$ARTIFACT_DIR"

log()  { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[warn]\033[0m %s\n' "$*"; }
die()  { printf '\033[1;31m[fail]\033[0m %s\n' "$*" >&2; exit 1; }

# ── run/state ────────────────────────────────────────────────────────────────
# A "run" is identified by a fresh space key. reset uses the previous run's key.

load_state() { [ -f "$STATE_FILE" ] && . "$STATE_FILE" || true; }

new_run() {
  load_state
  PREV_SPACE_KEY="${SPACE_KEY:-}"
  SPACE_KEY="${MIGRATION_SPACE_PREFIX}$(date +%y%m%d%H%M)"
  {
    echo "SPACE_KEY=$SPACE_KEY"
    echo "PREV_SPACE_KEY=$PREV_SPACE_KEY"
  } > "$STATE_FILE"
  log "Run space key: $SPACE_KEY  (previous: ${PREV_SPACE_KEY:-none})"
}

# Run one browser phase via Playwright. Extra env passed through.
run_browser_phase() {
  local ph="$1"
  load_state
  CMA_PHASE="$ph" \
  CMA_SPACE_KEY="${SPACE_KEY:-}" \
  CMA_PREV_SPACE_KEY="${PREV_SPACE_KEY:-}" \
  CMA_MANUAL_MIGRATE="${CMA_MANUAL_MIGRATE:-0}" \
    npx playwright test --config="$REPO_DIR/e2e/playwright.config.js" \
      "$REPO_DIR/e2e/tests/cma-migration.spec.js" -g "cma:$ph"
}

# ── phases ───────────────────────────────────────────────────────────────────

cmd_preflight() {
  log "Preflight checks"
  command -v docker >/dev/null || die "docker not found"
  command -v forge  >/dev/null || die "forge CLI not found"
  command -v npx    >/dev/null || die "npx not found"
  [ -f "$ENV_FILE" ] || warn "e2e/.env not found — see e2e/.env.example"
  [ -d "$LEGACY_DIR" ] || die "legacy repo not found at $LEGACY_DIR (set LEGACY_DIR)"

  # CDP browser reachable?
  if ! curl -sf "$CDP_ENDPOINT/json/version" >/dev/null 2>&1; then
    warn "No CDP browser at $CDP_ENDPOINT — run 'npm run test:e2e:browser' and log into BOTH the Server (admin/admin) and the Cloud site."
  fi

  # License: warn if the newest licenses/*.txt filename date is on/before today.
  local newest
  newest=$(ls -t "$LEGACY_DIR"/licenses/*_*.txt 2>/dev/null | head -1 || true)
  if [ -n "$newest" ]; then
    local d; d=$(basename "$newest" .txt | grep -oE '[0-9]{4}_[0-9]{2}_[0-9]{2}$' | tr '_' '-' || true)
    log "Newest license: $(basename "$newest") (date ${d:-unknown})"
    if [ -n "$d" ] && [ "$d" \< "$(date +%F)" ]; then
      warn "License date $d is in the past — trying it anyway. If Confluence refuses it, obtain a valid license (new trials are not self-service)."
    fi
  else
    warn "No license file in $LEGACY_DIR/licenses (SERVERID_YYYY_MM_DD.txt)"
  fi

  # Dev install present on the Cloud site?
  if ! forge install list 2>/dev/null | grep -qi "$FORGE_DEV_ENV"; then
    warn "No '$FORGE_DEV_ENV' installation found via 'forge install list' — run 'forge deploy -e $FORGE_DEV_ENV' and 'forge install -e $FORGE_DEV_ENV'."
  fi

  warn "Ensure the one-time Server↔Cloud CMA connection is established and NO 'forge tunnel' is running."
  log "Preflight done"
}

cmd_reset() {
  log "Reset: enable danger zone, wipe dev SQL, delete previous Cloud space"
  forge variables set -e "$FORGE_DEV_ENV" ENABLE_DELETE_ALL true >/dev/null 2>&1 \
    || warn "Could not set ENABLE_DELETE_ALL (continuing)"
  run_browser_phase reset
}

cmd_server_up() {
  log "Server-up: build + start + upload plugin (Confluence $CONFLUENCE_VERSION, env→$FORGE_DEV_ENV)"
  DS_FORGE_MIGRATION_ENV="$FORGE_DEV_ENV" bash "$LEGACY_DIR/scripts/test-plugin.sh" build "$CONFLUENCE_VERSION"
  DS_FORGE_MIGRATION_ENV="$FORGE_DEV_ENV" bash "$LEGACY_DIR/scripts/test-plugin.sh" start "$CONFLUENCE_VERSION"
  warn "If this is a fresh volume, complete the Confluence setup wizard once (license + DB) before upload succeeds."
  bash "$LEGACY_DIR/scripts/test-plugin.sh" upload "$CONFLUENCE_VERSION"
  bash "$LEGACY_DIR/scripts/test-plugin.sh" verify "$CONFLUENCE_VERSION"
}

cmd_fixtures() {
  load_state
  [ -n "${SPACE_KEY:-}" ] || die "No SPACE_KEY — run 'all' or 'reset' first"
  log "Fixtures: creating signed Server macros in space $SPACE_KEY"
  bash "$LEGACY_DIR/scripts/create-cma-test-fixtures.sh" "$SERVER_BASE_URL" "$SPACE_KEY"
}

cmd_darkon()  { log "Enabling CMA dev-mode dark feature";  run_browser_phase darkon; }
cmd_darkoff() { log "Disabling CMA dev-mode dark feature"; run_browser_phase darkoff; }

cmd_migrate() {
  log "Migrate: running CMA migration (Server → Cloud $FORGE_DEV_ENV)"
  if [ "${CMA_MANUAL_MIGRATE:-0}" = "1" ]; then
    run_browser_phase migrate
    read -r -p "Complete the CMA migration in the browser until it shows complete, then press Enter… "
  elif [ "${CMA_AUTOMATE_MIGRATE:-1}" = "1" ]; then
    if ! run_browser_phase migrate; then
      warn "Automated CMA wizard driving failed — falling back to a manual checkpoint."
      CMA_MANUAL_MIGRATE=1 run_browser_phase migrate
      read -r -p "Complete the CMA migration in the browser until it shows complete, then press Enter… "
    fi
  else
    CMA_MANUAL_MIGRATE=1 run_browser_phase migrate
    read -r -p "Complete the CMA migration in the browser until it shows complete, then press Enter… "
  fi
  capture_migration_logs
}

capture_migration_logs() {
  local art="$ARTIFACT_DIR/migration-logs-$(date +%Y%m%d-%H%M%S).txt"
  log "Capturing forge logs (-e $FORGE_DEV_ENV) → $art"
  # forge logs streams; bound it so we just snapshot the recent handler output.
  ( timeout 25 forge logs -e "$FORGE_DEV_ENV" 2>&1 || true ) | tee "$art" | grep -E '\[migration\]' || \
    warn "No [migration] lines captured (handler may not have run, or logs lag). See $art"
}

cmd_wizard() {
  log "Wizard: converting Server macros → Forge ADF via admin Migration tab"
  run_browser_phase wizard
}

cmd_verify() {
  log "Verify: asserting dev-env stats match expected fixture counts"
  run_browser_phase verify
}

cmd_finish() {
  log "Finishing: unsetting ENABLE_DELETE_ALL on $FORGE_DEV_ENV"
  forge variables unset -e "$FORGE_DEV_ENV" ENABLE_DELETE_ALL >/dev/null 2>&1 || true
}

cmd_all() {
  cmd_preflight
  new_run            # establish this run's fresh space key (after preflight)
  cmd_reset
  cmd_server_up
  cmd_fixtures
  cmd_darkon
  cmd_migrate
  cmd_darkoff
  cmd_wizard
  cmd_verify
  cmd_finish
  log "E2E CMA migration test complete."
}

PHASE="${1:-}"
case "$PHASE" in
  preflight) cmd_preflight ;;
  reset)     new_run; cmd_reset ;;
  server-up) cmd_server_up ;;
  fixtures)  cmd_fixtures ;;
  darkon)    cmd_darkon ;;
  migrate)   cmd_migrate ;;
  darkoff)   cmd_darkoff ;;
  wizard)    cmd_wizard ;;
  verify)    cmd_verify ;;
  finish)    cmd_finish ;;
  all)       cmd_all ;;
  *)         die "Unknown phase '${PHASE}'. Use: all | preflight reset server-up fixtures darkon migrate darkoff wizard verify finish" ;;
esac
