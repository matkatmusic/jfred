// Builds unnumbered commit and tool-call timeline rows from the wire document.

import { COMMIT_NODE_KIND, COMMIT_OPERATION_KIND, TOOL_CALL_NODE_KIND } from "./timeline-types.ts";
import type { CommitNode, ToolCallNode } from "./timeline-node-types.ts";
import type { WireScriptRun, WireTimelineDocument } from "./timeline-wire-types.ts";

// Commit nodes come from gitOperations, or from commitMarkers on older cached documents.
export function buildCommitNodes(document: WireTimelineDocument): CommitNode[] {
  const commitNodes: CommitNode[] = [];
  if (document.gitOperations === undefined) {
    for (const marker of document.commitMarkers) {
      commitNodes.push({
        kind: COMMIT_NODE_KIND,
        when: marker.timestamp,
        sessionId: marker.sessionId,
      });
    }
    return commitNodes;
  }
  for (const operation of document.gitOperations) {
    const isCommitOperation = operation.kind === COMMIT_OPERATION_KIND;
    if (!isCommitOperation)
      continue;
    commitNodes.push({
      kind: COMMIT_NODE_KIND,
      when: operation.timestamp,
      sessionId: operation.sessionId,
      detail: operation.detail,
      resultHash: operation.resultHash,
      isError: operation.isError,
    });
  }
  return commitNodes;
}

// uuids of tool-call records that ran a failed git command (task 103).
function collectFailedGitCommandUuids(document: WireTimelineDocument): Set<string | undefined> {
  const failedGitCommandUuids = new Set<string | undefined>();
  for (const operation of document.gitOperations ?? []) {
    const isFailed = operation.isError === true;
    if (isFailed)
      failedGitCommandUuids.add(operation.uuid);
  }
  return failedGitCommandUuids;
}

// task 67: only script runs that changed files attach to their rows.
function collectScriptRunsByToolUseId(document: WireTimelineDocument): Map<string, WireScriptRun> {
  const scriptRunsByToolUseId = new Map<string, WireScriptRun>();
  for (const run of document.scriptRuns ?? []) {
    const toolUseId = run.toolUseId;
    if (toolUseId === undefined)
      continue;
    const hasChangedPaths = run.changedPaths.length > 0;
    if (hasChangedPaths)
      scriptRunsByToolUseId.set(toolUseId, run);
  }
  return scriptRunsByToolUseId;
}

// One row per tool call (item 55); calls that ran a failed git command get isError (task 103).
export function buildToolCallNodes(document: WireTimelineDocument): ToolCallNode[] {
  const failedGitCommandUuids = collectFailedGitCommandUuids(document);
  const scriptRunsByToolUseId = collectScriptRunsByToolUseId(document);
  const toolCallNodes: ToolCallNode[] = [];
  for (const call of document.toolCalls ?? []) {
    toolCallNodes.push({
      kind: TOOL_CALL_NODE_KIND,
      when: call.timestamp,
      sessionId: call.sessionId,
      uuid: call.uuid,
      toolName: call.toolName,
      summary: call.summary,
      toolUseId: call.toolUseId,
      isOrphaned: call.isOrphaned === true,
      isError: failedGitCommandUuids.has(call.uuid) ? true : undefined,
      scriptRun: scriptRunsByToolUseId.get(call.toolUseId),
    });
  }
  return toolCallNodes;
}
