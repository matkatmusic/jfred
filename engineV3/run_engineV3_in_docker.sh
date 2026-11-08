#!/bin/sh
# Usage: sh engineV3/run_engineV3_in_docker.sh <repo folder> <jsonl folder> [<jsonl folder> ...]
set -eu

REPO_FOLDER="$1"
shift
ENGINE_FOLDER="$(cd "$(dirname "$0")" && pwd)"
JFRED_FOLDER="$(dirname "$ENGINE_FOLDER")"
# BUNDLE_FOLDER="$(mktemp -d)"

docker build -t engine-v3:1 "$ENGINE_FOLDER"
# bun build "$ENGINE_FOLDER/engineV3_replay.ts" --target=node --outfile="$BUNDLE_FOLDER/engineV3_replay.mjs"

NAME="engine-v3-$(date +%s)"
docker run -d --network none --name "$NAME" engine-v3:1 sleep infinity
trap 'docker rm -f "$NAME" >/dev/null' EXIT

docker exec "$NAME" mkdir -p /input/jfred "$REPO_FOLDER"
docker exec "$NAME" chown replay "$REPO_FOLDER"
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
docker exec "$NAME" chmod -R a+rX /input
for JSONL_FOLDER in "$@"; do
    docker exec "$NAME" chmod -R a+rX "$JSONL_FOLDER"
done

for JSONL_FOLDER in "$@"; do
    set -- "$@" --jsonl "$JSONL_FOLDER"
    shift
done
docker exec -u replay "$NAME" tsx /input/jfred/engineV3/engineV3_replay.ts --git-repo /input/repo.git --state "$REPO_FOLDER" --touched-out /tmp/touched-paths.txt "$@"

COMPARE_FOLDER="$(mktemp -d)"
echo "compare folder: $COMPARE_FOLDER"
docker cp "$NAME:$REPO_FOLDER" "$COMPARE_FOLDER/state"
docker cp "$NAME:/tmp/touched-paths.txt" "$COMPARE_FOLDER/touched-paths.txt"
"$JFRED_FOLDER/node_modules/.bin/tsx" "$ENGINE_FOLDER/engineV3_compare_disk.ts" --state "$COMPARE_FOLDER/state" --disk "$REPO_FOLDER" --touched "$COMPARE_FOLDER/touched-paths.txt"
