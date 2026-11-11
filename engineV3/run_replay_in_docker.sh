#!/bin/sh
# Usage: sh engineV3/run_replay_in_docker.sh --project <folder> --jsonl <folder> [--jsonl <folder> ...] [--file-history <folder>] [--git-repo <folder>] [--stop-before <jsonl file>:<line>]
# Set ENGINEV3_SNAPSHOT_VOLUME_PREFIX to give this worktree its own snapshot volumes.
set -eu

# Each setup stage prints one line before it runs and one line after it, so a slow stage shows on the console.
printSetupStageStart() {
    SETUP_STAGE_STARTED_AT="$(date +%s)"
    echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) setup: $1"
}
printSetupStageDone() {
    echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) setup: $1 done in $(( $(date +%s) - SETUP_STAGE_STARTED_AT ))s"
}

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
printSetupStageStart "state-folder cwd scan"
STATE_FOLDER="$(for JSONL_FOLDER in "$@"; do
    find "$JSONL_FOLDER" -name '*.jsonl' -exec jq -r '.cwd | strings | select(length > 0)' {} +
done | awk '{ print length($0) "\t" $0 }' | sort -n | head -n 1 | cut -f2-)"
if [ -z "$STATE_FOLDER" ]; then
    echo "no cwd found in the JSONL folders" >&2
    exit 1
fi
printSetupStageDone "state-folder cwd scan"
echo "state folder: $STATE_FOLDER"

if [ -n "$GIT_REPO_FOLDER" ]; then
    printSetupStageStart "lockfile collection"
    SEED_FOLDER="$(mktemp -d)"
    # Every bun.lock and package-lock.json in any commit goes into the image with its package.json, once per distinct content. No "workspaces" member package.json files are written.
    SEEN_SEEDS=" "
    LOCK_COMMIT=""
    LOCK_LOG="$(git -C "$GIT_REPO_FOLDER" -c core.quotepath=false log --all --format='commit %H' --name-only --diff-filter=ACMR -- '*bun.lock' '*package-lock.json')"
    while IFS= read -r LOG_LINE; do
        case "$LOG_LINE" in
            "commit "*) LOCK_COMMIT="${LOG_LINE#commit }" ;;
            *node_modules*) ;;
            bun.lock | */bun.lock | package-lock.json | */package-lock.json)
                LOCK_FOLDER="$(dirname "$LOG_LINE")"
                if [ "$LOCK_FOLDER" = "." ]; then
                    PACKAGE_JSON_PATH="package.json"
                else
                    PACKAGE_JSON_PATH="$LOCK_FOLDER/package.json"
                fi
                SEED_ID="$(git -C "$GIT_REPO_FOLDER" rev-parse "$LOCK_COMMIT:$LOG_LINE")-$(git -C "$GIT_REPO_FOLDER" rev-parse "$LOCK_COMMIT:$PACKAGE_JSON_PATH")"
                case "$SEEN_SEEDS" in
                    *" $SEED_ID "*) ;;
                    *)
                        SEEN_SEEDS="$SEEN_SEEDS$SEED_ID "
                        mkdir -p "$SEED_FOLDER/$SEED_ID"
                        git -C "$GIT_REPO_FOLDER" show "$LOCK_COMMIT:$PACKAGE_JSON_PATH" > "$SEED_FOLDER/$SEED_ID/package.json"
                        git -C "$GIT_REPO_FOLDER" show "$LOCK_COMMIT:$LOG_LINE" > "$SEED_FOLDER/$SEED_ID/$(basename "$LOG_LINE")"
                        ;;
                esac
                ;;
        esac
    done <<EOF
$LOCK_LOG
EOF
    printSetupStageDone "lockfile collection"
    printSetupStageStart "docker build"
    docker build -t ${ENGINEV3_IMAGE_TAG:-engine-v3:1} --build-context packageseed="$SEED_FOLDER" --build-context playwrightcache=/Users/matkatmusicllc/Library/Caches/ms-playwright "$ENGINE_FOLDER"
    printSetupStageDone "docker build"
else
    if ! docker image inspect ${ENGINEV3_IMAGE_TAG:-engine-v3:1} >/dev/null 2>&1; then
        echo "image ${ENGINEV3_IMAGE_TAG:-engine-v3:1} does not exist: run this script once with --git-repo to build it" >&2
        exit 1
    fi
fi

NAME="engine-v3-$(date +%s)-$$"
SNAPSHOT_VOLUME="${ENGINEV3_SNAPSHOT_VOLUME_PREFIX:-engineV3-snapshots}-$(basename "$PROJECT_FOLDER")"
# The volume is created in the container start stage, after the mount list is built.
# docker volume create "$SNAPSHOT_VOLUME" >/dev/null
printSetupStageStart "mounts"
# Every source is mounted read-only at the path the engine reads. The replay writes only to the state folder and /snapshots.
# "$@" holds the JSONL folders (also kept in JSONL_LIST); it is rebuilt after the mounts are listed.
set --
while IFS= read -r JSONL_FOLDER; do
    if [ -n "$JSONL_FOLDER" ]; then
        set -- "$@" -v "$JSONL_FOLDER:$JSONL_FOLDER:ro"
    fi
done <<EOF
$JSONL_LIST
EOF
TOOL_PARENT_FOLDERS="/Users/matkatmusicllc/Programming/dotfiles /Users/matkatmusicllc/Programming/career-ops/node_modules/playwright /Users/matkatmusicllc/.claude/claude_hooks"
for TOOL_FOLDER in $TOOL_PARENT_FOLDERS; do
    set -- "$@" -v "$TOOL_FOLDER:$TOOL_FOLDER:ro"
done
# Recorded Attune Bash calls read these paths outside the project, so each one is mounted read-only at its Mac path.
# Only for Attune: in another project one of these paths can be the state folder.
if [ "$STATE_FOLDER" = "/Users/matkatmusicllc/Programming/Attune" ]; then
    ATTUNE_OUTSIDE_PATHS="/Users/matkatmusicllc/Programming/harms /Users/matkatmusicllc/Programming/taskTools /Users/matkatmusicllc/Programming/sms_extractor /Users/matkatmusicllc/Programming/relationship-mermaid /Users/matkatmusicllc/Programming/wheels /Users/matkatmusicllc/Programming/nrc-eil /Users/matkatmusicllc/Programming/taskTools-worktrees /Users/matkatmusicllc/Programming/matkat_claude_libs /Users/matkatmusicllc/Programming/taskTools-86 /Users/matkatmusicllc/Programming/message-panel /Users/matkatmusicllc/Programming/taskTools-frozen /Users/matkatmusicllc/Downloads/dictionary-pages /Users/matkatmusicllc/Desktop/AffectVec-v1.0 /Users/matkatmusicllc/Desktop/Feelings+Wheel+Download-ables.pdf /Users/matkatmusicllc/.claude/plugins /Users/matkatmusicllc/.claude/tasks /Users/matkatmusicllc/.claude/skills /Users/matkatmusicllc/.claude/sessions /Users/matkatmusicllc/.claude/array-debt /Users/matkatmusicllc/.claude/usage-data /Users/matkatmusicllc/.claude/debug /Users/matkatmusicllc/.claude/commands"
    for OUTSIDE_PATH in $ATTUNE_OUTSIDE_PATHS; do
        # docker -v makes a missing source as an empty root-owned folder on the Mac
        if [ ! -e "$OUTSIDE_PATH" ]; then
            echo "outside path $OUTSIDE_PATH does not exist on the Mac" >&2
            exit 1
        fi
        set -- "$@" -v "$OUTSIDE_PATH:$OUTSIDE_PATH:ro"
    done
fi
if [ -n "$GIT_REPO_FOLDER" ]; then
    set -- "$@" -v "$GIT_REPO_FOLDER/.git:/input/repo.git:ro"
fi
if [ -n "$FILE_HISTORY_FOLDER" ]; then
    # Multi-source scenarios keep each source's backups in <project>/source-*/file-history; one merged copy on the Mac is mounted
    FILE_HISTORY_MOUNT_SOURCE="$FILE_HISTORY_FOLDER"
    SOURCE_FILE_HISTORY_FOLDERS="$(find "$PROJECT_FOLDER" -mindepth 2 -maxdepth 2 -type d -name file-history -path '*/source-*/file-history')"
    if [ -n "$SOURCE_FILE_HISTORY_FOLDERS" ]; then
        FILE_HISTORY_MOUNT_SOURCE="$(mktemp -d)"
        cp -R "$FILE_HISTORY_FOLDER/." "$FILE_HISTORY_MOUNT_SOURCE"
        while IFS= read -r SOURCE_FILE_HISTORY_FOLDER; do
            if [ -n "$SOURCE_FILE_HISTORY_FOLDER" ]; then
                cp -R "$SOURCE_FILE_HISTORY_FOLDER/." "$FILE_HISTORY_MOUNT_SOURCE"
            fi
        done <<EOF
$SOURCE_FILE_HISTORY_FOLDERS
EOF
    fi
    set -- "$@" -v "$FILE_HISTORY_MOUNT_SOURCE:/input/file-history:ro"
fi
set -- "$@" -v "$JFRED_FOLDER/src:/input/jfred/src:ro" -v "$JFRED_FOLDER/webapp:/input/jfred/webapp:ro" -v "$ENGINE_FOLDER:/input/jfred/engineV3:ro" -v "$JFRED_FOLDER/package.json:/input/jfred/package.json:ro"
# The 4 files of the jot plate hook, in their jot layout
JOT_FOLDER="$HOME/Programming/jot"
for JOT_FILE in common/scripts/plate/plate_capture_hook.py common/scripts/git_lib.py external/claude_plugin_lib/git_lib.py external/claude_plugin_lib/util_lib.py; do
    set -- "$@" -v "$JOT_FOLDER/$JOT_FILE:/input/jot/$JOT_FILE:ro"
done
# The Mac plate captures, under /input/plate with the same absolute path as on the Mac
MAC_PLATE_CAPTURE_FOLDERS="$(fd -HI -t d -E node_modules --full-path '/\.plate/captures$' "$PROJECT_FOLDER")"
while IFS= read -r CAPTURE_FOLDER; do
    if [ -n "$CAPTURE_FOLDER" ]; then
        CAPTURE_FOLDER="${CAPTURE_FOLDER%/}"
        set -- "$@" -v "$CAPTURE_FOLDER:/input/plate$CAPTURE_FOLDER:ro"
    fi
done <<EOF
$MAC_PLATE_CAPTURE_FOLDERS
EOF
# Without a git repo the engine writes these start files into the state folder
if [ -z "$GIT_REPO_FOLDER" ]; then
    for START_FILE in conftest.py tests/conftest.py .gitignore settings.json hooks.json block-compound.sh; do
        if [ -f "$PROJECT_FOLDER/$START_FILE" ]; then
            set -- "$@" -v "$PROJECT_FOLDER/$START_FILE:/input/start-files/$START_FILE:ro"
        fi
    done
fi
printSetupStageDone "mounts"
printSetupStageStart "hook files"
# The recorded Bash calls run `node ~/.claude/hooks/turn-done.ts`. On the Mac that link points to a file that claude_hooks commit db4822d removed,
# so the version just before that commit is used for every call (user decision). It reads ../shared/session-state.ts and ../.env.
CLAUDE_HOOKS_REPO=/Users/matkatmusicllc/Programming/dotfiles/claude/claude_hooks
HOOK_FILES_FOLDER="$(mktemp -d)"
git -C "$CLAUDE_HOOKS_REPO" archive db4822d~1 ask-dont-dump-issues shared | tar -x -C "$HOOK_FILES_FOLDER"
# sh has no pipefail, so a failed git archive would otherwise go unnoticed.
if [ ! -f "$HOOK_FILES_FOLDER/ask-dont-dump-issues/turn-done.ts" ]; then
    echo "git archive of $CLAUDE_HOOKS_REPO at db4822d~1 gave no ask-dont-dump-issues/turn-done.ts" >&2
    exit 1
fi
printf '%s\n' "CLAUDE_HOOKS_SESSION_STATE_DIR=/tmp/claude-hooks-session-state" > "$HOOK_FILES_FOLDER/.env"
set -- "$@" -v "$HOOK_FILES_FOLDER/ask-dont-dump-issues:/Users/matkatmusicllc/.claude/hooks:ro" -v "$HOOK_FILES_FOLDER/shared:/Users/matkatmusicllc/.claude/shared:ro" -v "$HOOK_FILES_FOLDER/.env:/Users/matkatmusicllc/.claude/.env:ro"
printSetupStageDone "hook files"
printSetupStageStart "container start"
docker volume create "$SNAPSHOT_VOLUME" >/dev/null
# User decision 8: recorded internet calls that change files run with the network; the read-only ones are skipped by the engine.
# docker run -d --network none --name "$NAME" -v "$SNAPSHOT_VOLUME:/snapshots" "$@" ${ENGINEV3_IMAGE_TAG:-engine-v3:1} sleep infinity
docker run -d --name "$NAME" -v "$SNAPSHOT_VOLUME:/snapshots" "$@" ${ENGINEV3_IMAGE_TAG:-engine-v3:1} sleep infinity
trap 'docker rm -f "$NAME" >/dev/null' EXIT
# From here on "$@" is the JSONL folders again
set --
while IFS= read -r JSONL_FOLDER; do
    if [ -n "$JSONL_FOLDER" ]; then
        set -- "$@" "$JSONL_FOLDER"
    fi
done <<EOF
$JSONL_LIST
EOF

docker exec "$NAME" mkdir -p /input/jfred "$STATE_FOLDER"
docker exec "$NAME" chown replay "$STATE_FOLDER" /snapshots
CHECK_FOLDER=""
if [ "$GIT_REPO_FOLDER" = "/Users/matkatmusicllc/Programming/typesafe-playground" ]; then
    CHECK_FOLDER=/Users/matkatmusicllc/Programming/typesafe-playground-check
    docker exec "$NAME" mkdir -p "$CHECK_FOLDER"
    docker exec "$NAME" chown replay "$CHECK_FOLDER"
fi

# The sources are mounted read-only above, so the old docker cp and chmod lines are commented out (chmod fails on a read-only mount).
# TOOL_PARENT_FOLDERS="/Users/matkatmusicllc/Programming/dotfiles /Users/matkatmusicllc/Programming/career-ops/node_modules/playwright /Users/matkatmusicllc/.claude/claude_hooks"
# for TOOL_FOLDER in $TOOL_PARENT_FOLDERS; do
#     docker exec "$NAME" mkdir -p "$(dirname "$TOOL_FOLDER")"
#     # --no-xattrs: macOS tar adds com.apple.provenance headers that docker cp rejects
#     tar -C / --no-xattrs --exclude=Users/matkatmusicllc/Programming/dotfiles/.git -cf - "${TOOL_FOLDER#/}" | docker cp - "$NAME:/"
#     docker exec "$NAME" chown -R root:root "$TOOL_FOLDER"
#     docker exec "$NAME" chmod -R a+rX,go-w "$TOOL_FOLDER"
# done
# On the Mac, ~/.claude/guides is a link into the dotfiles folder
docker exec "$NAME" ln -sfn /Users/matkatmusicllc/Programming/dotfiles/claude/guides /Users/matkatmusicllc/.claude/guides
docker exec "$NAME" ln -sfn /Users/matkatmusicllc/Programming/dotfiles/claude/settings.json /Users/matkatmusicllc/.claude/settings.json
# for JSONL_FOLDER in "$@"; do
#     docker exec "$NAME" mkdir -p "$(dirname "$JSONL_FOLDER")"
# done
#
# if [ -n "$GIT_REPO_FOLDER" ]; then
#     docker cp "$GIT_REPO_FOLDER/.git" "$NAME:/input/repo.git"
# fi
# if [ -n "$FILE_HISTORY_FOLDER" ]; then
#     docker cp "$FILE_HISTORY_FOLDER" "$NAME:/input/file-history"
#     # Multi-source scenarios keep each source's backups in <project>/source-*/file-history
#     SOURCE_FILE_HISTORY_FOLDERS="$(find "$PROJECT_FOLDER" -mindepth 2 -maxdepth 2 -type d -name file-history -path '*/source-*/file-history')"
#     while IFS= read -r SOURCE_FILE_HISTORY_FOLDER; do
#         if [ -n "$SOURCE_FILE_HISTORY_FOLDER" ]; then
#             docker cp "$SOURCE_FILE_HISTORY_FOLDER/." "$NAME:/input/file-history"
#         fi
#     done <<EOF
# $SOURCE_FILE_HISTORY_FOLDERS
# EOF
# fi
# for JSONL_FOLDER in "$@"; do
#     docker cp "$JSONL_FOLDER" "$NAME:$(dirname "$JSONL_FOLDER")/"
# done
# docker cp "$JFRED_FOLDER/src" "$NAME:/input/jfred/src"
# docker cp "$JFRED_FOLDER/webapp" "$NAME:/input/jfred/webapp"
# docker cp "$ENGINE_FOLDER" "$NAME:/input/jfred/engineV3"
# docker cp "$JFRED_FOLDER/package.json" "$NAME:/input/jfred/package.json"
# The 4 files of the jot plate hook, in their jot layout
# JOT_FOLDER="$HOME/Programming/jot"
# for JOT_FILE in common/scripts/plate/plate_capture_hook.py common/scripts/git_lib.py external/claude_plugin_lib/git_lib.py external/claude_plugin_lib/util_lib.py; do
#     docker exec "$NAME" mkdir -p "/input/jot/$(dirname "$JOT_FILE")"
#     docker cp "$JOT_FOLDER/$JOT_FILE" "$NAME:/input/jot/$JOT_FILE"
# done
# The engine reads /input/plate, so it always exists, even when no capture folder is mounted.
docker exec "$NAME" mkdir -p /input/plate
printSetupStageDone "container start"
# MAC_PLATE_CAPTURE_FOLDERS="$(fd -HI -t d -E node_modules --full-path '/\.plate/captures$' "$PROJECT_FOLDER")"
# while IFS= read -r CAPTURE_FOLDER; do
#     if [ -n "$CAPTURE_FOLDER" ]; then
#         CAPTURE_FOLDER="${CAPTURE_FOLDER%/}"
#         docker exec "$NAME" mkdir -p "/input/plate$CAPTURE_FOLDER"
#         docker cp "$CAPTURE_FOLDER/." "$NAME:/input/plate$CAPTURE_FOLDER"
#     fi
# done <<EOF
# $MAC_PLATE_CAPTURE_FOLDERS
# EOF
# if [ -z "$GIT_REPO_FOLDER" ]; then
#     docker exec "$NAME" mkdir -p /input/start-files
#     for START_FILE in conftest.py tests/conftest.py .gitignore settings.json hooks.json block-compound.sh; do
#         if [ -f "$PROJECT_FOLDER/$START_FILE" ]; then
#             docker exec "$NAME" mkdir -p "/input/start-files/$(dirname "$START_FILE")"
#             docker cp "$PROJECT_FOLDER/$START_FILE" "$NAME:/input/start-files/$START_FILE"
#         fi
#     done
# fi
# docker exec "$NAME" chmod -R a+rX /input
# for JSONL_FOLDER in "$@"; do
#     docker exec "$NAME" chmod -R a+rX "$JSONL_FOLDER"
# done

ENGINE_FLAGS="--snapshots /snapshots"
if [ -n "$GIT_REPO_FOLDER" ]; then
    ENGINE_FLAGS="$ENGINE_FLAGS --git-repo /input/repo.git"
    if [ "$GIT_REPO_FOLDER" = "/Users/matkatmusicllc/Programming/typesafe-playground" ]; then
        ENGINE_FLAGS="$ENGINE_FLAGS --watch $CHECK_FOLDER --playground-start-files"
    fi
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
printSetupStageStart "stand-ins"
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
printSetupStageDone "stand-ins"
if [ -n "$STOP_BEFORE" ]; then
    printSetupStageStart "engine start"
    # The engine stops with an error when it reaches the line, so a zero exit code means it never reached it.
    STOP_BEFORE_ENGINE_EXIT_CODE=0
    docker exec -u replay "$NAME" tsx /input/jfred/engineV3/engineV3_replay.ts --state "$STATE_FOLDER" --touched-out /tmp/touched-paths.txt --mac-plate /input/plate --jot /input/jot --stop-before "$STOP_BEFORE" $ENGINE_FLAGS "$@" || STOP_BEFORE_ENGINE_EXIT_CODE=$?
    printSetupStageDone "engine start"
    if [ "$STOP_BEFORE_ENGINE_EXIT_CODE" -eq 0 ]; then
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
printSetupStageStart "engine start"
ENGINE_EXIT_CODE=0
# shellcheck disable=SC2086
docker exec -u replay "$NAME" tsx /input/jfred/engineV3/engineV3_replay.ts --state "$STATE_FOLDER" --touched-out /tmp/touched-paths.txt --mac-plate /input/plate --jot /input/jot $ENGINE_FLAGS "$@" || ENGINE_EXIT_CODE=$?
printSetupStageDone "engine start"
if [ "$ENGINE_EXIT_CODE" -ne 0 ]; then
    exit "$ENGINE_EXIT_CODE"
fi

printSetupStageStart "copy-out"
echo "snapshot events / store size / blobs:"
docker run --rm -v "$SNAPSHOT_VOLUME:/snapshots" ${ENGINEV3_IMAGE_TAG:-engine-v3:1} sh -c 'ls /snapshots/events | wc -l; du -sh /snapshots; ls /snapshots/blobs | wc -l'

COMPARE_FOLDER="$(mktemp -d)"
echo "compare folder: $COMPARE_FOLDER"
docker cp "$NAME:$STATE_FOLDER" "$COMPARE_FOLDER/state"
docker cp "$NAME:/tmp/touched-paths.txt" "$COMPARE_FOLDER/touched-paths.txt"
printSetupStageDone "copy-out"
printSetupStageStart "disk check"
DISK_CHECK_EXIT_CODE=0
"$JFRED_FOLDER/node_modules/.bin/tsx" "$ENGINE_FOLDER/engineV3_compare_disk.ts" --state "$COMPARE_FOLDER/state" --disk "$PROJECT_FOLDER" --touched "$COMPARE_FOLDER/touched-paths.txt" || DISK_CHECK_EXIT_CODE=$?
printSetupStageDone "disk check"
exit "$DISK_CHECK_EXIT_CODE"
