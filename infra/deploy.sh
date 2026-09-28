#!/usr/bin/env bash
#
# Deploy a CDK stack from this repo, with the three machine-specific workarounds baked in.
# Run it from anywhere:   ./infra/deploy.sh analytics
#
# From a PowerShell prompt, name Git's bash explicitly — a bare `bash` there resolves to the WSL
# stub, which has no distro installed:
#   & "F:\Program Files\Git\bin\bash.exe" infra/deploy.sh analytics
#
# What it works around, and why each line is load-bearing:
#
#  1. `npx cdk` resolves the extensionless bin shim through npm's global `script-shell`, which on
#     this machine is Git bash. Launched from PowerShell that bash inherits a PATH with no
#     coreutils, so the shim's `sed`/`dirname` vanish and it execs `A:\aws-cdk\bin\cdk`. Calling
#     node against the real entry point skips the shim, so this script works from any parent shell.
#
#  2. CDK stages bundles as `<hash>-building` then renames to `<hash>`. That rename returns EPERM
#     on the A: volume, so staging is forced onto C: via --output.
#
#  3. POLL_ADMIN_SECRET lives on the deployed analytics Lambda but NOT in .env.local, which is the
#     only thing bin/infra.ts reads. Deploying without it in the environment sets the live variable
#     to empty and silently breaks poll ship/delete/devnote. We read the current value back off the
#     running function first and abort if it can't be recovered, because a wipe is invisible until
#     someone tries to ship a poll.
#
set -euo pipefail

REGION="us-east-1"
CDK_OUT="C:/Users/andje/AppData/Local/Temp/mtg-cdkout"
INFRA_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

usage() {
  cat <<'USAGE'
Usage: ./infra/deploy.sh <stack> [action] [-- <extra cdk args>]

  stack     analytics | tagger | site | all
  action    deploy (default) | diff | synth

Examples:
  ./infra/deploy.sh analytics          # deploy the analytics stack
  ./infra/deploy.sh analytics diff     # see what would change first
  ./infra/deploy.sh tagger
  ./infra/deploy.sh analytics deploy -- --hotswap
USAGE
}

case "${1:-}" in
  analytics) STACK="MtgDeckBuilderAnalytics" ;;
  tagger)    STACK="MtgDeckBuilderTagger" ;;
  site)      STACK="MtgDeckBuilderSite" ;;
  all)       STACK="--all" ;;
  -h|--help|"") usage; exit "${1:+0}" ;;
  *) echo "Unknown stack '$1'" >&2; echo >&2; usage >&2; exit 1 ;;
esac

ACTION="${2:-deploy}"
case "$ACTION" in
  deploy|diff|synth) ;;
  *) echo "Unknown action '$ACTION'" >&2; exit 1 ;;
esac

# Anything after `--` is handed to cdk untouched.
EXTRA=()
while [ $# -gt 0 ]; do
  if [ "$1" = "--" ]; then shift; EXTRA=("$@"); break; fi
  shift
done

cd "$INFRA_DIR"

# --- Workaround 3: preserve POLL_ADMIN_SECRET ------------------------------------------------
# Only the analytics stack carries it. Skipped when it is already exported, so CI or a one-off
# override still wins.
if { [ "$STACK" = "MtgDeckBuilderAnalytics" ] || [ "$STACK" = "--all" ]; } \
   && [ "$ACTION" != "synth" ] \
   && [ -z "${POLL_ADMIN_SECRET:-}" ]; then
  echo "Recovering POLL_ADMIN_SECRET from the running Lambda..."
  FN=$(aws lambda list-functions --region "$REGION" \
        --query "Functions[?contains(FunctionName,'MtgDeckBuilderAnalytics-AnalyticsHandler')].FunctionName" \
        --output text 2>/dev/null | head -n1 || true)

  if [ -n "$FN" ]; then
    POLL_ADMIN_SECRET=$(aws lambda get-function-configuration --region "$REGION" \
      --function-name "$FN" \
      --query "Environment.Variables.POLL_ADMIN_SECRET" --output text 2>/dev/null || true)
    [ "$POLL_ADMIN_SECRET" = "None" ] && POLL_ADMIN_SECRET=""
  fi

  if [ -z "${POLL_ADMIN_SECRET:-}" ]; then
    # A first-ever deploy has no function to read from; anything else means we could not reach it,
    # and continuing would blank the live value.
    cat >&2 <<'ABORT'
ERROR: could not read POLL_ADMIN_SECRET off the deployed analytics Lambda.

Deploying now would set that variable to empty and break poll ship/delete/devnote.
Check your AWS credentials, or if this is genuinely a first deploy, set it yourself:

    POLL_ADMIN_SECRET=<value> ./infra/deploy.sh analytics
ABORT
    exit 1
  fi
  export POLL_ADMIN_SECRET
  echo "  ok (${#POLL_ADMIN_SECRET} chars)"
fi

# --- Workarounds 1 and 2 ---------------------------------------------------------------------
CDK="node ./node_modules/aws-cdk/bin/cdk"
ARGS=("$ACTION" "$STACK" --output "$CDK_OUT")
[ "$ACTION" = "deploy" ] && ARGS+=(--require-approval never)
[ ${#EXTRA[@]} -gt 0 ] && ARGS+=("${EXTRA[@]}")

echo "cdk ${ARGS[*]}"
exec $CDK "${ARGS[@]}"
