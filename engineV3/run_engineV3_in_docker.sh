#!/bin/sh
# Usage: sh engineV3/run_engineV3_in_docker.sh <repo folder> <jsonl folder> [<jsonl folder> ...]
set -eu

REPO_FOLDER="$1"
shift
ENGINE_FOLDER="$(cd "$(dirname "$0")" && pwd)"
JFRED_FOLDER="$(dirname "$ENGINE_FOLDER")"
# BUNDLE_FOLDER="$(mktemp -d)"

SEED_FOLDER="$(mktemp -d)"
# playground/package.json has no "workspaces" key in any commit, so no member package.json files are written
for LOCK_COMMIT in $(git -C "$REPO_FOLDER" log --all --format=%H -- playground/bun.lock); do
    mkdir -p "$SEED_FOLDER/$LOCK_COMMIT"
    git -C "$REPO_FOLDER" show "$LOCK_COMMIT:playground/package.json" > "$SEED_FOLDER/$LOCK_COMMIT/package.json"
    git -C "$REPO_FOLDER" show "$LOCK_COMMIT:playground/bun.lock" > "$SEED_FOLDER/$LOCK_COMMIT/bun.lock"
done

# docker build -t engine-v3:1 "$ENGINE_FOLDER"
docker build -t engine-v3:1 --build-context bunseed="$SEED_FOLDER" "$ENGINE_FOLDER"
# bun build "$ENGINE_FOLDER/engineV3_replay.ts" --target=node --outfile="$BUNDLE_FOLDER/engineV3_replay.mjs"

NAME="engine-v3-$(date +%s)"
docker run -d --network none --name "$NAME" engine-v3:1 sleep infinity
trap 'docker rm -f "$NAME" >/dev/null' EXIT

docker exec "$NAME" mkdir -p /input/jfred "$REPO_FOLDER"
docker exec "$NAME" chown replay "$REPO_FOLDER"
CHECK_FOLDER=/Users/matkatmusicllc/Programming/typesafe-playground-check
docker exec "$NAME" mkdir -p "$CHECK_FOLDER"
docker exec "$NAME" chown replay "$CHECK_FOLDER"

TOOL_PARENT_FOLDERS="/Users/matkatmusicllc/Programming/dotfiles /Users/matkatmusicllc/Programming/career-ops/node_modules/playwright /Users/matkatmusicllc/Library/Caches/ms-playwright /Users/matkatmusicllc/.claude/claude_hooks"
for TOOL_FOLDER in $TOOL_PARENT_FOLDERS; do
    docker exec "$NAME" mkdir -p "$(dirname "$TOOL_FOLDER")"
    # --no-xattrs: macOS tar adds com.apple.provenance headers that docker cp rejects
    tar -C / --no-xattrs --exclude=Users/matkatmusicllc/Programming/dotfiles/.git -cf - "${TOOL_FOLDER#/}" | docker cp - "$NAME:/"
    docker exec "$NAME" chown -R root:root "$TOOL_FOLDER"
    docker exec "$NAME" chmod -R a+rX,go-w "$TOOL_FOLDER"
done
# On the Mac, ~/.claude/guides is a link into the dotfiles folder
docker exec "$NAME" ln -sfn /Users/matkatmusicllc/Programming/dotfiles/claude/guides /Users/matkatmusicllc/.claude/guides
for JSONL_FOLDER in "$@"; do
    docker exec "$NAME" mkdir -p "$(dirname "$JSONL_FOLDER")"
done

docker cp "$REPO_FOLDER/.git" "$NAME:/input/repo.git"
for JSONL_FOLDER in "$@"; do
    docker cp "$JSONL_FOLDER" "$NAME:$(dirname "$JSONL_FOLDER")/"
done
# docker cp "$BUNDLE_FOLDER/engineV3_replay.mjs" "$NAME:/input/"
docker cp "$JFRED_FOLDER/src" "$NAME:/input/jfred/src"
docker cp "$JFRED_FOLDER/webapp" "$NAME:/input/jfred/webapp"
docker cp "$ENGINE_FOLDER" "$NAME:/input/jfred/engineV3"
docker cp "$JFRED_FOLDER/package.json" "$NAME:/input/jfred/package.json"
# The 4 files of the jot plate hook, in their jot layout
JOT_FOLDER="$HOME/Programming/jot"
for JOT_FILE in common/scripts/plate/plate_capture_hook.py common/scripts/git_lib.py external/claude_plugin_lib/git_lib.py external/claude_plugin_lib/util_lib.py; do
    docker exec "$NAME" mkdir -p "/input/jot/$(dirname "$JOT_FILE")"
    docker cp "$JOT_FOLDER/$JOT_FILE" "$NAME:/input/jot/$JOT_FILE"
done
# The Mac plate captures, under /input/plate with the same absolute path as on the Mac
MAC_PLATE_CAPTURE_FOLDERS="/Users/matkatmusicllc/Programming/typesafe-playground/.plate/captures /Users/matkatmusicllc/Programming/typesafe-playground/playground/.plate/captures /Users/matkatmusicllc/Programming/typesafe-playground/playground/client/.plate/captures /Users/matkatmusicllc/Programming/typesafe-playground/playground/typesafe-checks/.plate/captures"
for CAPTURE_FOLDER in $MAC_PLATE_CAPTURE_FOLDERS; do
    docker exec "$NAME" mkdir -p "/input/plate$CAPTURE_FOLDER"
    docker cp "$CAPTURE_FOLDER/." "$NAME:/input/plate$CAPTURE_FOLDER"
done
docker exec "$NAME" chmod -R a+rX /input
for JSONL_FOLDER in "$@"; do
    docker exec "$NAME" chmod -R a+rX "$JSONL_FOLDER"
done

for JSONL_FOLDER in "$@"; do
    set -- "$@" --jsonl "$JSONL_FOLDER"
    shift
done
# Stand-ins for programs that were listening on the recorded Mac (see engineV3_standins.json). They write no files.
docker exec -d -u replay "$NAME" bun -e 'Bun.listen({ hostname: "0.0.0.0", port: 3000, socket: { data() {} } }); Bun.listen({ hostname: "127.0.0.1", port: 37777, socket: { data() {} } });'
docker exec -d -u replay "$NAME" node -e 'const net = require("net"); for (const port of [7420, 59824, 56656]) { net.createServer().listen(port, "127.0.0.1"); }'
for STANDIN_PORT in 3000 37777 7420 59824 56656; do
    STANDIN_ATTEMPTS=0
    until docker exec -u replay "$NAME" lsof -iTCP:"$STANDIN_PORT" -sTCP:LISTEN -n -P >/dev/null; do
        STANDIN_ATTEMPTS=$((STANDIN_ATTEMPTS + 1))
        if [ "$STANDIN_ATTEMPTS" -ge 10 ]; then
            echo "stand-in port $STANDIN_PORT is not listening" >&2
            exit 1
        fi
        sleep 0.5
    done
done
docker exec -u replay "$NAME" tsx /input/jfred/engineV3/engineV3_replay.ts --git-repo /input/repo.git --state "$REPO_FOLDER" --touched-out /tmp/touched-paths.txt --mac-plate /input/plate --jot /input/jot "$@"

COMPARE_FOLDER="$(mktemp -d)"
echo "compare folder: $COMPARE_FOLDER"
docker cp "$NAME:$REPO_FOLDER" "$COMPARE_FOLDER/state"
docker cp "$NAME:/tmp/touched-paths.txt" "$COMPARE_FOLDER/touched-paths.txt"
"$JFRED_FOLDER/node_modules/.bin/tsx" "$ENGINE_FOLDER/engineV3_compare_disk.ts" --state "$COMPARE_FOLDER/state" --disk "$REPO_FOLDER" --touched "$COMPARE_FOLDER/touched-paths.txt"
