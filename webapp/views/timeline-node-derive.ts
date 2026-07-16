// Commit-node and tool-call-node derivation (split from timeline-nodes.ts, 250-line cap):
// the wire document's gitOperations and toolCalls become their unnumbered timeline rows.

import {
    COMMIT_NODE_KIND,
    COMMIT_OPERATION_KIND,
    TOOL_CALL_NODE_KIND,
    type CommitNode,
    type ToolCallNode,
    type WireScriptRun,
    type WireTimelineDocument,
} from "./timeline-types.ts";

// Commit pick hard-stops: from the document's commit operations (which carry the message) when it
// ships gitOperations; an older cached document lacks the field and falls back to commitMarkers.
export function deriveCommitNodes(document: WireTimelineDocument): CommitNode[] {
    if (document.gitOperations === undefined) {
        return document.commitMarkers.map((marker) => ({
            kind: COMMIT_NODE_KIND,
            when: marker.timestamp,
            sessionId: marker.sessionId,
        }));
    }
    return document.gitOperations
        .filter((operation) => operation.kind === COMMIT_OPERATION_KIND)
        .map((operation) => ({
            kind: COMMIT_NODE_KIND,
            when: operation.timestamp,
            sessionId: operation.sessionId,
            detail: operation.detail,
            resultHash: operation.resultHash,
            isError: operation.isError,
        }));
}

// One un-bubbled row per document tool call (item 55); the sort interleaves them chronologically
// with the turns they ran between. A call whose record ran a FAILED git command is stamped
// isError (task 103: joined by record uuid to the errored gitOperations — only git rows badge,
// not every failed tool call; hook-rewrite rows carry the attachment record's uuid and never match).
export function deriveToolCallNodes(document: WireTimelineDocument): ToolCallNode[] {
    const failedGitCommandUuids = new Set(
        (document.gitOperations ?? [])
            .filter((operation) => operation.isError === true)
            .map((operation) => operation.uuid),
    );
    // task 67: only runs the sandbox proved modified files ride their rows — a read-only run
    // (empty changedPaths) behaves like any other tool call.
    const scriptRunsByToolUseId = new Map<string, WireScriptRun>(
        (document.scriptRuns ?? [])
            .filter((run) => run.toolUseId !== undefined && run.changedPaths.length > 0)
            .map((run) => [run.toolUseId!, run]),
    );
    return (document.toolCalls ?? []).map((call) => ({
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
    }));
}
