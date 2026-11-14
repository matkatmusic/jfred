// Lists the plate hook runs that the Mac capture files record, as timeline events.

import { readFileSync, readdirSync } from "node:fs";
import { basename, dirname, join, relative } from "node:path";
import { Path, Uuid } from "../src/structures/domain.ts";
import { listTranscriptFiles } from "../src/viewer_api_layer1_sources.ts";
import { TimelineEventKind, type TimelineEvent } from "./engineV3.ts";

export enum PlateEventName {
  PostToolBatch = "PostToolBatch",
  SubagentStop = "SubagentStop",
}

export type PlateToolCall = { tool_name: string; tool_input: object; tool_use_id: string; tool_response?: unknown };
export type PlateCaptureFile = { session_id: string; transcript_path: string; file_changes: Record<string, string | null>; tool_calls: PlateToolCall[] };
export type PlateRun = { captureFile: Path; eventName: PlateEventName; cwd: Path; sessionId: Uuid; transcriptPath: Path; toolCalls: PlateToolCall[]; agentTranscriptPath: Path | undefined; timeMs: number };

const USER_SESSION_ID = "user";
const PLATE_FOLDER_NAME = ".plate";
const SUBAGENT_FOLDER_SEGMENT = "/subagents/";
const TOOL_USE_ID_PATTERN = /"id":"(toolu_[A-Za-z0-9_]+)"/g;

export function readPlateCaptureFile(captureFile: Path): PlateCaptureFile {
  return JSON.parse(readFileSync(captureFile.toString(), "utf8")) as PlateCaptureFile;
}

export function getPlateCaptureTimeMs(captureFile: Path): number {
  const nanoseconds = BigInt(basename(captureFile.toString()).split("_")[0] as string);
  return Number(nanoseconds / 1000000n);
}

// PostToolBatch copies Claude Code's tool calls (with tool_response); SubagentStop rebuilds them from the subagent file (_extractToolCallsFromTranscript: no tool_response).
export function getPlateEventName(toolCalls: PlateToolCall[]): PlateEventName {
  let responseCount = 0;
  for (const toolCall of toolCalls) {
    if (toolCall.tool_response !== undefined) {
      responseCount++;
    }
  }
  if (responseCount === toolCalls.length) {
    return PlateEventName.PostToolBatch;
  }
  if (responseCount === 0) {
    return PlateEventName.SubagentStop;
  }
  throw new Error(`getPlateEventName: some tool calls have a tool_response and some do not (${responseCount} of ${toolCalls.length})`);
}

function addCapturesFolderFiles(plateFolder: string, captureFiles: Path[]): void {
  const capturesFolder = join(plateFolder, "captures");
  for (const name of readdirSync(capturesFolder)) {
    captureFiles.push(new Path(join(capturesFolder, name)));
  }
}

function listCaptureFiles(folder: string, captureFiles: Path[]): void {
  for (const entry of readdirSync(folder, { withFileTypes: true })) {
    if (entry.name === PLATE_FOLDER_NAME) {
      addCapturesFolderFiles(join(folder, entry.name), captureFiles);
    }
    else if (entry.isDirectory()) {
      listCaptureFiles(join(folder, entry.name), captureFiles);
    }
  }
}

function createSubagentIndex(jsonlsPaths: Path[]): Map<string, Path> {
  const subagentFileByToolUseId = new Map<string, Path>();
  const jsonlFolderTexts: string[] = [];
  for (const jsonlsPath of jsonlsPaths) {
    jsonlFolderTexts.push(jsonlsPath.toString());
  }
  for (const transcriptFile of listTranscriptFiles(jsonlFolderTexts)) {
    if (transcriptFile.toString().includes(SUBAGENT_FOLDER_SEGMENT)) {
      for (const match of readFileSync(transcriptFile.toString(), "utf8").matchAll(TOOL_USE_ID_PATTERN)) {
        subagentFileByToolUseId.set(match[1] as string, transcriptFile);
      }
    }
  }
  return subagentFileByToolUseId;
}

function findSubagentTranscript(toolCalls: PlateToolCall[], subagentIndex: Map<string, Path>): Path {
  for (const toolCall of toolCalls) {
    const subagentFile = subagentIndex.get(toolCall.tool_use_id);
    if (subagentFile !== undefined) {
      return subagentFile;
    }
  }
  const toolUseIds: string[] = [];
  for (const toolCall of toolCalls) {
    toolUseIds.push(toolCall.tool_use_id);
  }
  throw new Error(`findSubagentTranscript: no subagent file holds the tool_use_ids ${toolUseIds.join(",")}`);
}

function compareRunTimes(first: PlateRun, second: PlateRun): number {
  return first.timeMs - second.timeMs;
}

function createPlateRun(macPlatePath: Path, captureFile: Path, capture: PlateCaptureFile, subagentIndex: Map<string, Path>): PlateRun {
  const eventName = getPlateEventName(capture.tool_calls);
  const projectFolder = dirname(dirname(dirname(captureFile.toString())));
  const cwd = new Path("/" + relative(macPlatePath.toString(), projectFolder));
  let agentTranscriptPath: Path | undefined = undefined;
  if (eventName === PlateEventName.SubagentStop) {
    agentTranscriptPath = findSubagentTranscript(capture.tool_calls, subagentIndex);
  }
  return { captureFile, eventName, cwd, sessionId: new Uuid(capture.session_id), transcriptPath: new Path(capture.transcript_path), toolCalls: capture.tool_calls, agentTranscriptPath, timeMs: getPlateCaptureTimeMs(captureFile) };
}

function createReplayedSessionIds(jsonlsPaths: Path[]): Set<string> {
  const jsonlFolderTexts: string[] = [];
  for (const jsonlsPath of jsonlsPaths) {
    jsonlFolderTexts.push(jsonlsPath.toString());
  }
  const replayedSessionIds = new Set<string>();
  for (const transcriptFile of listTranscriptFiles(jsonlFolderTexts)) {
    if (!transcriptFile.toString().includes(SUBAGENT_FOLDER_SEGMENT)) {
      replayedSessionIds.add(basename(transcriptFile.toString(), ".jsonl"));
    }
  }
  return replayedSessionIds;
}

// One run = one agent capture; a "user" capture is a by-product of a run.
// A capture from a session that is not a replayed JSONL session is ignored, and one line says so.
export function listPlateRuns(macPlatePath: Path, jsonlsPaths: Path[]): PlateRun[] {
  const captureFiles: Path[] = [];
  listCaptureFiles(macPlatePath.toString(), captureFiles);
  const subagentIndex = createSubagentIndex(jsonlsPaths);
  const replayedSessionIds = createReplayedSessionIds(jsonlsPaths);
  const runs: PlateRun[] = [];
  for (const captureFile of captureFiles) {
    const capture = readPlateCaptureFile(captureFile);
    if (capture.session_id !== USER_SESSION_ID) {
      if (replayedSessionIds.has(capture.session_id)) {
        runs.push(createPlateRun(macPlatePath, captureFile, capture, subagentIndex));
      }
      else {
        console.log(`ignored plate capture: session ${capture.session_id} is not a replayed session, file ${captureFile.toString()}`);
      }
    }
  }
  return runs.sort(compareRunTimes);
}

function compareEventTimestamps(first: TimelineEvent, second: TimelineEvent): number {
  return first.timestamp - second.timestamp;
}

// A tie keeps the earlier list first; with no Mac plate folder there are no plate events.
export function mergePlateEventsIntoActions(actionEvents: TimelineEvent[], macPlatePath: Path | undefined, jsonlsPaths: Path[]): TimelineEvent[] {
  const events = [...actionEvents];
  if (macPlatePath !== undefined) {
    for (const capture of listPlateRuns(macPlatePath, jsonlsPaths)) {
      events.push({ type: TimelineEventKind.PlateCapture, capture, timestamp: capture.timeMs });
    }
  }
  return events.sort(compareEventTimestamps);
}
