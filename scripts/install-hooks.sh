#!/bin/sh
# Install git hooks — scripts/git-hooks/* → .git/hooks/
#
# Run once per clone: bash scripts/install-hooks.sh
# Or via npm run setup:hooks

set -e
ROOT="$(git rev-parse --show-toplevel)"
SRC="$ROOT/scripts/git-hooks"
DST="$ROOT/.git/hooks"

if [ ! -d "$DST" ]; then
  echo "❌ .git/hooks 디렉토리 없음 — git repo 아닐 수도"
  exit 1
fi

for hook in "$SRC"/*; do
  name=$(basename "$hook")
  cp "$hook" "$DST/$name"
  chmod +x "$DST/$name"
  echo "✅ installed: $DST/$name"
done

echo ""
echo "→ git push 시 자동 npm run verify 실행 + fail 시 차단."
echo "→ 우회: git push --no-verify (긴급 시만)"
