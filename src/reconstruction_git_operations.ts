// Parsed git operations for the timeline; commit events live in reconstruction_git_commit_events.ts.

import { BlockType, ToolName } from "./structures/vocabulary.ts";
import { GitOperationKind } from "./structures/vocabulary_views.ts";
import { Uuid } from "./structures/domain.ts";
import type { TranscriptRecord } from "./structures/envelope.ts";
import { getContentBlocks } from "./structures/content-blocks.ts";
import { bareCommitHashToken, gitCommandStart, gitCommitResultHashLine } from "./regex_expressions.ts";
import { parseGitCommandWords } from "./reconstruction_git_command_words.ts";

// Splits a `&&`-chained command into trimmed segments (task 89).
// ponytail: a literal `&&` INSIDE a quoted argument would split wrongly — no transcript exercises that; move to a quote-aware scan if one ever does.
export function splitCompoundCommandSegments(command: string): string[] {
  const segments: string[] = [];
  for (const segment of command.split("&&"))
    segments.push(segment.trim());
  return segments;
}

// A single parsed git command for the timeline row.
export type GitOperation = {
  kind: GitOperationKind;
  detail: string;
  command: string;
  timestamp: Date;
  sessionId: Uuid | undefined;
  uuid: Uuid | undefined;
  // Short commit hash from tool_result; primitive per coding-requirements 1.
  resultHash?: string;
  // True when tool_result carried is_error (task 103); stamps all compound segments.
  isError?: boolean;
};

// A tool_result's output text and error flag for operation parsing.
type GitCommandResult = { text: string; isError: boolean };

// Parses one Bash command into operations, one per git `&&` segment (task 103).
function parseOperationsFromCommand(
  command: string,
  timestamp: Date,
  sessionId: Uuid | undefined,
  uuid: Uuid | undefined,
  result: GitCommandResult | undefined,
): GitOperation[] {
  const operations: GitOperation[] = [];
  for (const segment of splitCompoundCommandSegments(command)) {
    const startsWithGit = segment.match(gitCommandStart) !== null;
    if (!startsWithGit)
      continue;
    const operation = parseGitOperation(segment, timestamp, sessionId, uuid);
    if (result !== undefined) {
      if (operation.kind === GitOperationKind.commit)
        operation.resultHash = extractCommitHashFromResultText(result.text);
      if (result.isError)
        operation.isError = true;
    }
    operations.push(operation);
  }
  return operations;
}

// One git command string -> its parsed operation (kind + detail from the tokenized words).
function parseGitOperation(
  command: string,
  timestamp: Date,
  sessionId: Uuid | undefined,
  uuid: Uuid | undefined,
): GitOperation {
  const words = parseGitCommandWords(command);
  return {
    kind: words.kind,
    detail: words.detail,
    command,
    timestamp,
    sessionId,
    uuid,
  };
}

// Extracts short commit hash from tool_result summary line or bare hex token.
export function extractCommitHashFromResultText(resultText: string): string | undefined {
  const summaryMatch = resultText.match(gitCommitResultHashLine);
  if (summaryMatch !== null)
    return summaryMatch[1];
  const bareTokenMatch = resultText.match(bareCommitHashToken);
  if (bareTokenMatch === null)
    return undefined;
  return bareTokenMatch[1];
}

// Collect tool_result text and error flag by tool_use id for operation lookup.
function collectToolResultsByToolUseId(records: TranscriptRecord[]): Map<string, GitCommandResult> {
  const resultById = new Map<string, GitCommandResult>();
  for (const record of records) {
    for (const block of getContentBlocks(record)) {
      if (block.type !== BlockType.tool_result)
        continue;
      if (typeof block.content !== "string")
        continue;
      resultById.set(block.tool_use_id.toString(), { text: block.content, isError: block.is_error });
    }
  }
  return resultById;
}

// Extracts every git operation from transcript Bash records for the timeline.
export function findGitOperations(records: TranscriptRecord[]): GitOperation[] {
  const resultById = collectToolResultsByToolUseId(records);
  const operations: GitOperation[] = [];
  for (const record of records) {
    const timestamp = record.timestamp;
    if (!(timestamp instanceof Date))
      continue;
    for (const block of getContentBlocks(record)) {
      if (block.type !== BlockType.tool_use)
        continue;
      if (block.name !== ToolName.Bash)
        continue;
      const command = (block.input as { command?: string }).command;
      if (command === undefined)
        continue;
      const result = resultById.get(block.id.toString());
      operations.push(...parseOperationsFromCommand(command, timestamp, record.sessionId, record.uuid, result));
    }
  }
  return operations;
}
