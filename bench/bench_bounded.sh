#!/bin/bash
# Task 192 benchmark wrapper: the exact bounded single-file command from
# terminalLaunchCommands.txt (RevEng root), timed cold, with wall time, peak RSS,
# and the engine's final `counters: {...}` stderr line collected into a JSON report.
# Run from the RevEng root: ./jfred/bench/bench_bounded.sh
set -euo pipefail
JSON_OUT=/tmp/plate_cli_bounded.json
LOG_OUT=/tmp/plate_cli_bounded_progress.log
REPORT_OUT=/tmp/plate_cli_bounded_report.json
START_ISO=$(date +"%Y-%m-%dT%H:%M:%S%z")
/usr/bin/time -l npx tsx jfred/src/reconstruction_cli.ts \
  ~/Programming/jot-recovery/claude-data/projects/-Users-matkatmusicllc-Programming-jot/*.jsonl \
  --until-revision /Users/matkatmusicllc/Programming/jot/common/scripts/plate/plate_cli.py \
  --file /Users/matkatmusicllc/Programming/jot/common/scripts/plate/plate_cli.py \
  --repo ~/Programming/jot \
  --base-commit 793e65241902f276caf5f5c28d539269e7d36d11 \
  --fhsLoc ~/Programming/jot-recovery/claude-data/file-history \
  --branch surviving --json --progress \
  > "$JSON_OUT" 2> "$LOG_OUT"
END_ISO=$(date +"%Y-%m-%dT%H:%M:%S%z")
START_ISO="$START_ISO" END_ISO="$END_ISO" LOG_OUT="$LOG_OUT" REPORT_OUT="$REPORT_OUT" node -e '
const { readFileSync, writeFileSync } = require("node:fs");
const log = readFileSync(process.env.LOG_OUT, "utf8");
const real = log.match(/^\s*([\d.]+)\s+real\b/m);
const rss = log.match(/(\d+)\s+maximum resident set size/);
const counterLines = log.split("\n").filter((line) => line.startsWith("counters: "));
const last = counterLines[counterLines.length - 1];
writeFileSync(process.env.REPORT_OUT, JSON.stringify({
  start: process.env.START_ISO,
  end: process.env.END_ISO,
  wallSeconds: real ? Number(real[1]) : null,
  peakRssBytes: rss ? Number(rss[1]) : null,
  counters: last ? JSON.parse(last.slice("counters: ".length)) : null,
}, null, 2) + "\n");
'
echo "report: $REPORT_OUT"
