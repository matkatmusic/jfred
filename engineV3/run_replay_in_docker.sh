#!/bin/sh
# Usage: sh engineV3/run_replay_in_docker.sh --project <folder> --jsonl <folder> [--jsonl <folder> ...] [--file-history <folder>] [--git-repo <folder>] [--stop-before <jsonl file>:<line>]
# Set ENGINEV3_SNAPSHOT_VOLUME_PREFIX to give this worktree its own snapshot volumes.
set -eu

PROJECT_FOLDER=""
FILE_HISTORY_FOLDER=""
GIT_REPO_FOLDER=""
JSONL_LIST=""
STOP_BEFORE=""
while [ $# -gt 0 ]; do
    case "$1" in
        --project) PROJECT_FOLDER="$(cd "${2:?--project needs a folder}" && pwd)" ;;
        --jsonl) JSONL_LIST="$JSONL_LIST$(cd "${2:?--jsonl needs a folder}" && pwd)
" ;;
        --file-history) FILE_HISTORY_FOLDER="$(cd "${2:?--file-history needs a folder}" && pwd)" ;;
        --git-repo) GIT_REPO_FOLDER="$(cd "${2:?--git-repo needs a folder}" && pwd)" ;;
        --stop-before) STOP_BEFORE="${2:?--stop-before needs <jsonl file>:<line>}" ;;
        *) echo "unknown flag: $1" >&2; exit 1 ;;
    esac
    shift 2
done
if [ -z "$PROJECT_FOLDER" ]; then
    echo "--project is required" >&2
    exit 1
fi
if [ -z "$JSONL_LIST" ]; then
    echo "at least one --jsonl is required" >&2
    exit 1
fi
# From here on "$@" is the JSONL folders
set --
while IFS= read -r JSONL_FOLDER; do
    if [ -n "$JSONL_FOLDER" ]; then
        set -- "$@" "$JSONL_FOLDER"
    fi
done <<EOF
$JSONL_LIST
EOF

ENGINE_FOLDER="$(cd "$(dirname "$0")" && pwd)"
JFRED_FOLDER="$(dirname "$ENGINE_FOLDER")"

# The state path inside the container is the shortest cwd found in the JSONL folders
STATE_FOLDER="$(for JSONL_FOLDER in "$@"; do
    find "$JSONL_FOLDER" -name '*.jsonl' -exec jq -r '.cwd | strings | select(length > 0)' {} +
done | awk '{ print length($0) "\t" $0 }' | sort -n | head -n 1 | cut -f2-)"
if [ -z "$STATE_FOLDER" ]; then
    echo "no cwd found in the JSONL folders" >&2
    exit 1
fi
echo "state folder: $STATE_FOLDER"

if [ -n "$GIT_REPO_FOLDER" ]; then
    SEED_FOLDER="$(mktemp -d)"
    # playground/package.json has no "workspaces" key in any commit, so no member package.json files are written
    for LOCK_COMMIT in $(git -C "$GIT_REPO_FOLDER" log --all --format=%H -- playground/bun.lock); do
        mkdir -p "$SEED_FOLDER/$LOCK_COMMIT"
        git -C "$GIT_REPO_FOLDER" show "$LOCK_COMMIT:playground/package.json" > "$SEED_FOLDER/$LOCK_COMMIT/package.json"
        git -C "$GIT_REPO_FOLDER" show "$LOCK_COMMIT:playground/bun.lock" > "$SEED_FOLDER/$LOCK_COMMIT/bun.lock"
    done
    docker build -t engine-v3:1 --build-context bunseed="$SEED_FOLDER" --build-context playwrightcache=/Users/matkatmusicllc/Library/Caches/ms-playwright "$ENGINE_FOLDER"
else
    if ! docker image inspect engine-v3:1 >/dev/null 2>&1; then
        echo "image engine-v3:1 does not exist: run this script once with --git-repo to build it" >&2
        exit 1
    fi
fi

NAME="engine-v3-$(date +%s)-$$"
SNAPSHOT_VOLUME="${ENGINEV3_SNAPSHOT_VOLUME_PREFIX:-engineV3-snapshots}-$(basename "$PROJECT_FOLDER")"
docker volume create "$SNAPSHOT_VOLUME" >/dev/null
docker run -d --network none --name "$NAME" -v "$SNAPSHOT_VOLUME:/snapshots" engine-v3:1 sleep infinity
trap 'docker rm -f "$NAME" >/dev/null' EXIT

docker exec "$NAME" mkdir -p /input/jfred "$STATE_FOLDER"
docker exec "$NAME" chown replay "$STATE_FOLDER" /snapshots
if [ -n "$GIT_REPO_FOLDER" ]; then
    CHECK_FOLDER=/Users/matkatmusicllc/Programming/typesafe-playground-check
    docker exec "$NAME" mkdir -p "$CHECK_FOLDER"
    docker exec "$NAME" chown replay "$CHECK_FOLDER"
fi

TOOL_PARENT_FOLDERS="/Users/matkatmusicllc/Programming/dotfiles /Users/matkatmusicllc/Programming/career-ops/node_modules/playwright /Users/matkatmusicllc/.claude/claude_hooks"
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

if [ -n "$GIT_REPO_FOLDER" ]; then
    docker cp "$GIT_REPO_FOLDER/.git" "$NAME:/input/repo.git"
fi
if [ -n "$FILE_HISTORY_FOLDER" ]; then
    docker cp "$FILE_HISTORY_FOLDER" "$NAME:/input/file-history"
fi
for JSONL_FOLDER in "$@"; do
    docker cp "$JSONL_FOLDER" "$NAME:$(dirname "$JSONL_FOLDER")/"
done
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
# The Mac plate captures, under /input/plate with the same absolute path as on the Mac. The engine reads /input/plate, so it always exists.
docker exec "$NAME" mkdir -p /input/plate
MAC_PLATE_CAPTURE_FOLDERS="$(fd -HI -t d --full-path '/\.plate/captures$' "$PROJECT_FOLDER")"
while IFS= read -r CAPTURE_FOLDER; do
    if [ -n "$CAPTURE_FOLDER" ]; then
        CAPTURE_FOLDER="${CAPTURE_FOLDER%/}"
        docker exec "$NAME" mkdir -p "/input/plate$CAPTURE_FOLDER"
        docker cp "$CAPTURE_FOLDER/." "$NAME:/input/plate$CAPTURE_FOLDER"
    fi
done <<EOF
$MAC_PLATE_CAPTURE_FOLDERS
EOF
# Without a git repo the engine writes these start files into the state folder
if [ -z "$GIT_REPO_FOLDER" ]; then
    docker exec "$NAME" mkdir -p /input/start-files
    for START_FILE in conftest.py tests/conftest.py .gitignore settings.json hooks.json block-compound.sh; do
        if [ -f "$PROJECT_FOLDER/$START_FILE" ]; then
            docker exec "$NAME" mkdir -p "/input/start-files/$(dirname "$START_FILE")"
            docker cp "$PROJECT_FOLDER/$START_FILE" "$NAME:/input/start-files/$START_FILE"
        fi
    done
fi
docker exec "$NAME" chmod -R a+rX /input
for JSONL_FOLDER in "$@"; do
    docker exec "$NAME" chmod -R a+rX "$JSONL_FOLDER"
done

ENGINE_FLAGS="--snapshots /snapshots"
if [ -n "$GIT_REPO_FOLDER" ]; then
    ENGINE_FLAGS="$ENGINE_FLAGS --git-repo /input/repo.git --watch $CHECK_FOLDER"
else
    ENGINE_FLAGS="$ENGINE_FLAGS --start-files /input/start-files"
fi
if [ -n "$FILE_HISTORY_FOLDER" ]; then
    ENGINE_FLAGS="$ENGINE_FLAGS --file-history /input/file-history"
fi
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
if [ -n "$STOP_BEFORE" ]; then
    if docker exec -u replay "$NAME" tsx /input/jfred/engineV3/engineV3_replay.ts --state "$STATE_FOLDER" --touched-out /tmp/touched-paths.txt --mac-plate /input/plate --jot /input/jot --stop-before "$STOP_BEFORE" $ENGINE_FLAGS "$@"; then
        echo "the replay never reached $STOP_BEFORE" >&2
        exit 1
    fi
    STOPPED_FOLDER="$ENGINE_FOLDER/stopped/$(basename "$PROJECT_FOLDER")"
    # Each stop replaces the last one for this scenario
    rm -rf "$STOPPED_FOLDER"
    mkdir -p "$STOPPED_FOLDER"
    docker cp "$NAME:$STATE_FOLDER" "$STOPPED_FOLDER/state"
    docker cp "$NAME:/tmp/next-line.json" "$STOPPED_FOLDER/next-line.json"
    echo "stopped before: $STOP_BEFORE"
    echo "folder: $STOPPED_FOLDER"
    exit 0
fi
# ENGINE_FLAGS holds only container paths without spaces, so it is left unquoted
# shellcheck disable=SC2086
docker exec -u replay "$NAME" tsx /input/jfred/engineV3/engineV3_replay.ts --state "$STATE_FOLDER" --touched-out /tmp/touched-paths.txt --mac-plate /input/plate --jot /input/jot $ENGINE_FLAGS "$@"

echo "snapshot events / store size / blobs:"
docker run --rm -v "$SNAPSHOT_VOLUME:/snapshots" engine-v3:1 sh -c 'ls /snapshots/events | wc -l; du -sh /snapshots; ls /snapshots/blobs | wc -l'

COMPARE_FOLDER="$(mktemp -d)"
echo "compare folder: $COMPARE_FOLDER"
docker cp "$NAME:$STATE_FOLDER" "$COMPARE_FOLDER/state"
docker cp "$NAME:/tmp/touched-paths.txt" "$COMPARE_FOLDER/touched-paths.txt"
"$JFRED_FOLDER/node_modules/.bin/tsx" "$ENGINE_FOLDER/engineV3_compare_disk.ts" --state "$COMPARE_FOLDER/state" --disk "$PROJECT_FOLDER" --touched "$COMPARE_FOLDER/touched-paths.txt"
