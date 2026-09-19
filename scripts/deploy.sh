#!/usr/bin/env bash
# Deploy hook for the environment-tier pipeline (.github/workflows/deploy.yml).
#
# THIS IS A PLACEHOLDER. No hosting provider has been chosen for this project
# yet (see README "What's next" / docs/ENVIRONMENTS.md), so there is nothing
# real to deploy to. This script exists so the pipeline's structure — build,
# test, promote through environments, gate preprod/production on approval —
# can run and be exercised end to end today, without pretending a real
# deploy happened.
#
# To wire up a real target: replace the "TODO" block below with whatever
# your host needs (examples: `flyctl deploy`, `railway up`, a Docker
# build+push+SSH restart, a Render/Vercel CLI deploy hook). Each tier's
# config values live in deploy/environments/<tier>.env.example as a
# reference for which env vars that tier's real secrets should set — this
# script does not read secrets out of those files, since they're examples,
# not the real per-environment config (that lives in the GitHub Environment's
# own secrets, or wherever your host stores it).

set -euo pipefail

ENVIRONMENT="${1:-}"
VALID_ENVIRONMENTS=("development" "uat" "preprod" "production")

if [[ -z "$ENVIRONMENT" ]]; then
  echo "Usage: $0 <development|uat|preprod|production>" >&2
  exit 1
fi

valid=false
for env in "${VALID_ENVIRONMENTS[@]}"; do
  if [[ "$env" == "$ENVIRONMENT" ]]; then
    valid=true
    break
  fi
done
if [[ "$valid" != "true" ]]; then
  echo "Unknown environment '$ENVIRONMENT' — expected one of: ${VALID_ENVIRONMENTS[*]}" >&2
  exit 1
fi

echo "=== deploy.sh: $ENVIRONMENT ==="
echo "[stub] No hosting provider is configured yet — nothing was actually deployed."
echo "[stub] Reference config for this tier: deploy/environments/${ENVIRONMENT}.env.example"
echo "[stub] Fill in the TODO block in scripts/deploy.sh with real deploy commands"
echo "[stub] once a host is chosen (see docs/ENVIRONMENTS.md)."

# TODO: real deploy commands for $ENVIRONMENT go here, e.g.:
#   flyctl deploy --config "deploy/fly.${ENVIRONMENT}.toml" --remote-only
#   railway up --environment "$ENVIRONMENT"
#   docker build -t "myapp:${ENVIRONMENT}" . && docker push ... && ssh host "..."

exit 0
