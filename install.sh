#!/usr/bin/env bash
# Wire the jfredToolsPlugin into Claude Code.
# If a claude() wrapper already exists (~/.zshrc or ~/.claude/init.sh), insert a
# `--plugin-dir <this-clone>/jfredToolsPlugin \` continuation line after its
# `command claude \` invocation; otherwise append a fresh wrapper to ~/.zshrc.
# Asks before touching anything. --dry-run previews the change and exits.
# The inserted path is this clone's absolute path; re-run if the clone moves.
set -euo pipefail

JFRED_ROOT="$(cd "$(dirname "$0")" && pwd)"
PLUGIN_DIR="$JFRED_ROOT/jfredToolsPlugin"

git -C "$JFRED_ROOT" submodule update --init --recursive

WRAP_FILE=""
for f in "$HOME/.zshrc" "$HOME/.claude/init.sh"; do
  if [ -f "$f" ] && grep -q "jfredToolsPlugin" "$f"; then
    echo "jfredToolsPlugin already referenced in $f — nothing to do."
    exit 0
  fi
  if [ -z "$WRAP_FILE" ] && [ -f "$f" ] && grep -qE '^[[:space:]]*claude[[:space:]]*\(\)' "$f"; then
    WRAP_FILE="$f"
  fi
done

confirm() {
  read -r -p "$1 [y/N] " answer
  case "$answer" in
    y|Y) ;;
    *) echo "Skipped — nothing touched. Enable manually with:"
       echo "  claude --plugin-dir \"$PLUGIN_DIR\""
       exit 0 ;;
  esac
}

if [ -n "$WRAP_FILE" ]; then
  # Amend the existing wrapper. Only the multi-line `command claude \` form is
  # supported — a bare `command claude plugin ...` helper line is left alone.
  if ! grep -qE 'command claude[[:space:]]*\\$' "$WRAP_FILE"; then
    echo "claude() wrapper in $WRAP_FILE has no 'command claude \\' line to amend."
    echo "Add this flag to it by hand: --plugin-dir \"$PLUGIN_DIR\""
    exit 1
  fi
  NEW_LINE="    --plugin-dir \"$PLUGIN_DIR\" \\"
  echo "Existing claude() wrapper found in $WRAP_FILE."
  echo "Would insert after its 'command claude \\' line:"
  echo "$NEW_LINE"
  if [ "${1:-}" = "--dry-run" ]; then
    exit 0
  fi
  confirm "Amend $WRAP_FILE?"
  NEW_LINE="$NEW_LINE" awk '{print} /command claude[[:space:]]*\\$/ {print ENVIRON["NEW_LINE"]}' \
    "$WRAP_FILE" > "$WRAP_FILE.tmp" && mv "$WRAP_FILE.tmp" "$WRAP_FILE"
  echo "Done. Restart your shell (or re-source $WRAP_FILE) to pick up the flag."
  exit 0
fi

WRAPPER_BLOCK="
# jfredToolsPlugin (added by jfred/install.sh)
claude() {
  command claude --plugin-dir \"$PLUGIN_DIR\" \"\$@\"
}
"

ZSHRC="$HOME/.zshrc"
echo "No existing claude() wrapper found. This will append to $ZSHRC:"
echo "$WRAPPER_BLOCK"
if [ "${1:-}" = "--dry-run" ]; then
  exit 0
fi
confirm "Append to $ZSHRC?"
echo "$WRAPPER_BLOCK" >> "$ZSHRC"
echo "Done. Restart your shell (or 'source $ZSHRC') to pick up the wrapper."
