#!/usr/bin/env bash
# Vercel ignoreCommand — exit 0 = skip build, exit 1 = run build
#
# Skip Vercel build when only docs/metadata changed (no runtime code).
# This is what eats build hours: 100+ docs-only commits/day = 100+ wasted builds.
#
# Skipped paths:
#   research_history/  — daily milestone txt logs (no code)
#   reports/           — generated report JSON snapshots
#   logs/              — runtime log dumps
#   *.md               — README, CLAUDE.md, FEATURES.md, METRICS.md, etc.
#   .claude/           — Claude Code agent metadata
#   .github/ISSUE_TEMPLATE/, .github/PULL_REQUEST_TEMPLATE/ — repo metadata
#
# Anything else (src/, messages/, vercel.json, package.json, scripts/, .github/workflows/)
# triggers a real build.

set -e

# First-deploy / shallow-clone safety: HEAD^ may not exist
if ! git rev-parse HEAD^ >/dev/null 2>&1; then
  echo "No HEAD^ available — running build to be safe"
  exit 1
fi

# Use pathspec exclusions: if anything OUTSIDE the excluded set changed, build.
if git diff --quiet HEAD^ HEAD -- \
  ':(exclude)research_history' \
  ':(exclude)reports' \
  ':(exclude)logs' \
  ':(exclude).claude' \
  ':(exclude)*.md'; then
  echo "Only docs/metadata changed since HEAD^ — skipping build"
  exit 0
fi

echo "Runtime code changed — running build"
exit 1
