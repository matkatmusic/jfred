// Runs the real jot plate hook for one Mac capture run, then compares the new capture with the Mac capture.

import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";
import { Path } from "../src/structures/domain.ts";
import { PlateEventName, getPlateCaptureTimeMs, readPlateCaptureFile, readPlateCaptureSessionId, type PlateRun } from "./engineV3_replay_plate.ts";
import { writeCutTranscript } from "./engineV3_replay_plate_transcript.ts";

const HOOK_FILE = "common/scripts/plate/plate_capture_hook.py";
const HOOK_TIMEOUT_MILLISECONDS = 120000;
const MAX_DIFF_LINES = 20;
const USER_SESSION_ID = "user";
const DELETED_FILE_TEXT = "<deleted file>";

function listCaptureNames(cwd: Path): string[] {
  const capturesFolder = join(cwd.toString(), ".plate", "captures");
  if (existsSync(capturesFolder)) {
    return readdirSync(capturesFolder);
  }
  return [];
}

function createHookInput(run: PlateRun): string {
  const input: Record<string, unknown> = { hook_event_name: run.eventName, cwd: run.cwd.toString(), session_id: run.sessionId.toString(), transcript_path: run.transcriptPath.toString() };
  if (run.eventName === PlateEventName.PostToolBatch) {
    input.tool_calls = run.toolCalls;
  }
  else {
    input.agent_transcript_path = writeCutTranscript(run.agentTranscriptPath as Path, getPlateCaptureTimeMs(run.captureFile)).toString();
  }
  return JSON.stringify(input);
}

function findNewAgentCapture(run: PlateRun, namesBefore: string[]): Path {
  let newestCapture: Path | undefined = undefined;
  for (const name of listCaptureNames(run.cwd)) {
    const captureFile = new Path(join(run.cwd.toString(), ".plate", "captures", name));
    const isNew = !namesBefore.includes(name);
    if (isNew) {
      const isAgent = readPlateCaptureSessionId(captureFile) !== USER_SESSION_ID;
      if (isAgent) {
        newestCapture = captureFile;
      }
    }
  }
  if (newestCapture === undefined) {
    throw new Error(`findNewAgentCapture: the hook wrote no agent capture in ${run.cwd.toString()} for ${basename(run.captureFile.toString())}`);
  }
  return newestCapture;
}

// Returns the agent capture file that the hook wrote in this run.
export function executePlateHook(run: PlateRun, jotPath: Path): Path {
  const namesBefore = listCaptureNames(run.cwd);
  const hookFile = join(jotPath.toString(), HOOK_FILE);
  const env = { ...process.env, CLAUDE_PLUGIN_ROOT: jotPath.toString() };
  const result = spawnSync("python3", [hookFile], { input: createHookInput(run), env, encoding: "utf8", timeout: HOOK_TIMEOUT_MILLISECONDS });
  if (result.status !== 0) {
    throw new Error(`executePlateHook: the hook exited with ${result.status} for ${basename(run.captureFile.toString())}: ${result.stderr}`);
  }
  return findNewAgentCapture(run, namesBefore);
}

function formatLineDifference(macText: string, replayText: string): string {
  const macLines = macText.split("\n");
  const replayLines = replayText.split("\n");
  const differences: string[] = [];
  for (let index = 0; index < Math.max(macLines.length, replayLines.length); index++) {
    if (macLines[index] !== replayLines[index]) {
      differences.push(`line ${index + 1}: mac=${JSON.stringify(macLines[index])} replay=${JSON.stringify(replayLines[index])}`);
    }
    if (differences.length === MAX_DIFF_LINES) {
      break;
    }
  }
  return differences.join("\n");
}

function createCaptureDescription(macCapture: Path): string {
  return `Mac capture ${basename(macCapture.toString())} at ${new Date(getPlateCaptureTimeMs(macCapture)).toISOString()}`;
}

function assertTextInBothCaptures(filePath: string, macCapture: Path, macText: string | null | undefined, replayText: string | null | undefined): void {
  if (replayText === undefined) {
    throw new Error(`assertPlateCapturesEqual: ${filePath} is missing in the replay capture (${createCaptureDescription(macCapture)})`);
  }
  if (macText === undefined) {
    throw new Error(`assertPlateCapturesEqual: ${filePath} is missing in the Mac capture (${createCaptureDescription(macCapture)})`);
  }
  if (macText !== replayText) {
    const difference = formatLineDifference(macText ?? DELETED_FILE_TEXT, replayText ?? DELETED_FILE_TEXT);
    throw new Error(`assertPlateCapturesEqual: ${filePath} differs (${createCaptureDescription(macCapture)})\n${difference}`);
  }
}

// Every path in either file_changes map must be in the other with the same text.
export function assertPlateCapturesEqual(macCapture: Path, replayCapture: Path): void {
  const macChanges = readPlateCaptureFile(macCapture).file_changes;
  const replayChanges = readPlateCaptureFile(replayCapture).file_changes;
  for (const filePath of Object.keys(macChanges)) {
    assertTextInBothCaptures(filePath, macCapture, macChanges[filePath], replayChanges[filePath]);
  }
  for (const filePath of Object.keys(replayChanges)) {
    assertTextInBothCaptures(filePath, macCapture, macChanges[filePath], replayChanges[filePath]);
  }
}

export function executePlateRun(run: PlateRun, jotPath: Path): void {
  const replayCapture = executePlateHook(run, jotPath);
  assertPlateCapturesEqual(run.captureFile, replayCapture);
}
