#!/usr/bin/env bash
# Wire the jfredToolsPlugin into Claude Code by adding a claude() wrapper to
# ~/.zshrc that launches `claude --plugin-dir <this-clone>/jfredToolsPlugin`.
# Asks before touching ~/.zshrc. --dry-run prints the block and exits.
# The wrapper bakes in this clone's absolute path; re-run if the clone moves.
set -euo pipefail

JFRED_ROOT="$(cd "$(dirname "$0")" && pwd)"
ZSHRC="$HOME/.zshrc"

git -C "$JFRED_ROOT" submodule update --init --recursive

WRAPPER_BLOCK="
# jfredToolsPlugin (added by jfred/install.sh)
claude() {
  command claude --plugin-dir \"$JFRED_ROOT/jfredToolsPlugin\" \"\$@\"
}
"

if [ "${1:-}" = "--dry-run" ]; then
  echo "Would append to $ZSHRC:"
  echo "$WRAPPER_BLOCK"
  exit 0
fi

if [ -f "$ZSHRC" ] && grep -q "jfredToolsPlugin" "$ZSHRC"; then
  echo "jfredToolsPlugin already referenced in $ZSHRC — nothing to do."
  exit 0
fi

echo "This will append to $ZSHRC:"
echo "$WRAPPER_BLOCK"
read -r -p "Append to $ZSHRC? [y/N] " answer
case "$answer" in
  y|Y) ;;
  *) echo "Skipped — $ZSHRC untouched. Enable manually with:"
     echo "  claude --plugin-dir \"$JFRED_ROOT/jfredToolsPlugin\""
     exit 0 ;;
esac

echo "$WRAPPER_BLOCK" >> "$ZSHRC"
echo "Done. Restart your shell (or 'source $ZSHRC') to pick up the wrapper."
