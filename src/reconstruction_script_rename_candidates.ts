// Collects rename candidates from executor runs and orders them by timestamp for the script rename extractor.

import type { ContentBlock } from "./structures/content-blocks.ts";
import type { TranscriptRecord } from "./structures/envelope.ts";
import { readWriteInput } from "./structures/tool-result-shapes.ts";
import { BlockType, EventKind, EXECUTOR_TOOL_NAMES, ToolName } from "./structures/vocabulary.ts";
import { Path, type Uuid } from "./structures/domain.ts";
import { resolveAgainstCwd } from "./structures/path-resolve.ts";
import type { FileEvent } from "./reconstruction_events.ts";
import { codeLiteralMoveCall, renameArrowLine } from "./regex_expressions.ts";

export type ExecutorRun = { id: Uuid; timestamp: Date; cwd: Path | undefined; code: string | undefined };

// Both evidence channels pool here so the guard rules in EXECUTOR-timestamp order, not readdir order.
export type RenameCandidate = { changeId: Uuid; from: Path; to: Path; timestamp: Date };

function getBlockText(block: unknown): string {
  const isTextBlock = Boolean(block) && typeof block === "object" && "text" in (block as object);
  return isTextBlock ? String((block as { text: unknown }).text) : "";
}

function getToolResultText(record: TranscriptRecord): string {
  const raw = (record as { toolUseResult?: unknown }).toolUseResult;
  if (typeof raw === "string") {
    return raw;
  }
  const isBlockArray = Array.isArray(raw);
  if (isBlockArray) {
    const blockTexts: string[] = [];
    for (const block of raw) {
      blockTexts.push(getBlockText(block));
    }
    return blockTexts.join("\n");
  }
  const stdout = raw && typeof raw === "object" ? (raw as { stdout?: unknown }).stdout : undefined;
  return typeof stdout === "string" ? stdout : "";
}

function getBasenameOf(value: string): string {
  const slash = value.lastIndexOf("/");
  return slash >= 0 ? value.slice(slash + 1) : value;
}

// Finds renames done inside scripts from the printed `old -> new` line, since they leave no tool_use event.
export function collectExecutorAndWrittenBasename(block: ContentBlock, timestamp: Date | undefined, recordCwd: Path | undefined, executors: Map<string, ExecutorRun>, writtenBasenames: Set<string>, erroredIds: Set<string>): void {
  if (block.type !== BlockType.tool_use) {
    return;
  }
  const isUnerroredWrite = block.name === ToolName.Write && !erroredIds.has(block.id.toString());
  if (isUnerroredWrite) {
    writtenBasenames.add(getBasenameOf(readWriteInput(block).filePath.toString()));
  }
  if (block.name === ToolName.Edit) {
    const filePath = (block.input as { file_path?: string }).file_path;
    if (filePath !== undefined) {
      writtenBasenames.add(getBasenameOf(filePath));
    }
  }
  const isTimestampedExecutor = EXECUTOR_TOOL_NAMES.has(block.name) && timestamp instanceof Date;
  if (isTimestampedExecutor) {
    const cwd = (block.input as { cwd?: string }).cwd;
    const code = (block.input as { code?: string }).code;
    executors.set(block.id.toString(), { id: block.id, timestamp, cwd: cwd !== undefined ? new Path(cwd) : recordCwd, code });
  }
}

// Candidates stamp at the RESULT instant, not the tool_use's, since a consent-delayed MCP move can sit pending for minutes.
export function collectRenameCandidatesFromToolResult(block: ContentBlock, record: TranscriptRecord, executors: Map<string, ExecutorRun>, completionInstantByExecutorId: Map<string, Date>, candidates: RenameCandidate[]): void {
  if (block.type !== BlockType.tool_result) {
    return;
  }
  const executor = executors.get(block.tool_use_id.toString());
  if (executor === undefined) {
    return;
  }
  const resultInstant = record.timestamp instanceof Date ? record.timestamp : executor.timestamp;
  if (block.is_error !== true) {
    completionInstantByExecutorId.set(block.tool_use_id.toString(), resultInstant);
  }
  for (const match of getToolResultText(record).matchAll(renameArrowLine)) {
    const [, from, to] = match;
    // ponytail: guard moved — see filterRenameCandidatesInTimestampOrder
    // if (!writtenBasenames.has(getBasenameOf(from!))) {
    //     continue;
    // }
    candidates.push({
      changeId: block.tool_use_id,
      from: new Path(resolveAgainstCwd(executor.cwd, new Path(from!))),
      to: new Path(resolveAgainstCwd(executor.cwd, new Path(to!))),
      timestamp: resultInstant,
    });
  }
}

// Code-literal channel (s87 step 89): a COMPLETED run's two-string-literal `shutil.move(...)`/`os.rename(...)` call evidences a rename even with no arrow line.
export function collectRenameCandidatesFromCompletedRunCode(executor: ExecutorRun, completionInstantByExecutorId: Map<string, Date>, candidates: RenameCandidate[]): void {
  if (executor.code === undefined) {
    return;
  }
  const completionInstant = completionInstantByExecutorId.get(executor.id.toString());
  if (completionInstant === undefined) {
    return;
  }
  for (const match of executor.code.matchAll(codeLiteralMoveCall)) {
    const [, from, to] = match;
    candidates.push({
      changeId: executor.id,
      from: new Path(resolveAgainstCwd(executor.cwd, new Path(from!))),
      to: new Path(resolveAgainstCwd(executor.cwd, new Path(to!))),
      timestamp: completionInstant,
    });
  }
}

function compareCandidatesByTimestamp(a: RenameCandidate, b: RenameCandidate): number {
  return a.timestamp.getTime() - b.timestamp.getTime();
}

// A rename source must be a Write or Edit target, or an earlier rename's destination. This lets chains work.
export function filterRenameCandidatesInTimestampOrder(candidates: RenameCandidate[], writtenBasenames: Set<string>): FileEvent[] {
  const sortedCandidates = [...candidates].sort(compareCandidatesByTimestamp);
  const knownSourceBasenames = new Set(writtenBasenames);
  const seenCandidateKeys = new Set<string>();
  const events: FileEvent[] = [];
  for (const candidate of sortedCandidates) {
    const candidateKey = `${candidate.changeId.toString()}|${candidate.from.toString()}|${candidate.to.toString()}`;
    const isDuplicate = seenCandidateKeys.has(candidateKey);
    if (isDuplicate) {
      continue;
    }
    seenCandidateKeys.add(candidateKey);
    const isKnownSource = knownSourceBasenames.has(getBasenameOf(candidate.from.toString()));
    if (!isKnownSource) {
      continue;
    }
    knownSourceBasenames.add(getBasenameOf(candidate.to.toString()));
    events.push({
      kind: EventKind.rename,
      changeId: candidate.changeId,
      from: candidate.from,
      to: candidate.to,
      timestamp: candidate.timestamp,
    });
  }
  return events;
}
