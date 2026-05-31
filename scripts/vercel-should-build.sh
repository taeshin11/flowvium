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

# 2026-06-01: 이전엔 HEAD^ 와 비교 → batched push(코드 커밋 뒤 docs 커밋이 tip)에서
#   HEAD(docs) vs HEAD^(docs) diff 가 비어 SKIP → 중간 코드 커밋이 영영 미배포.
#   CLAUDE.md 가 권장하는 "commit 누적 후 1 push" 와 정면 충돌. → 마지막 *배포된* 커밋
#   (VERCEL_GIT_PREVIOUS_SHA) 와 비교. 없거나 접근 불가하면 HEAD^ 폴백, 그것도 없으면 build.
BASE="${VERCEL_GIT_PREVIOUS_SHA:-HEAD^}"
if ! git rev-parse "$BASE" >/dev/null 2>&1; then
  echo "Base ($BASE) unavailable — running build to be safe"
  exit 1
fi

# Use pathspec exclusions: if anything OUTSIDE the excluded set changed, build.
if git diff --quiet "$BASE" HEAD -- \
  ':(exclude)research_history' \
  ':(exclude)reports' \
  ':(exclude)logs' \
  ':(exclude).claude' \
  ':(exclude)*.md'; then
  echo "Only docs/metadata changed since last deploy ($BASE) — skipping build"
  exit 0
fi

echo "Runtime code changed — running build"
exit 1
