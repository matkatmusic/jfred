// Fabrication helpers for the multi-source merge tests (tasks 174/175): two-source temp trees and Write/Edit record pairs in the exact captured wire shape (scenarios/executed/s1, s12).  Fixtures load through loadTranscript so records carry real source stamps — a stamp-skipping loader would make the sidecar reader fall back to the LIVE ~/.claude/file-history.

import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadTranscript } from "../src/parse/loadTranscript.ts";
import { Path } from "../src/structures/domain.ts";
import type { TranscriptRecord } from "../src/structures/envelope.ts";
import type { SourceEntry } from "../src/reconstruction_overrides.ts";

export const SESSION_A = "aaaaaaaa-1111-2222-3333-444444444444";
export const SESSION_B = "bbbbbbbb-1111-2222-3333-444444444444";

export type SourceTree = { treeRoot: string; projectDir: string };

// A copied-out-of-~/.claude tree: <X>/projects/<projectName> plus the <X>/file-history sibling.
export function makeSourceTree(projectName: string): SourceTree {
    const treeRoot = mkdtempSync(join(tmpdir(), "multi-source-test-"));
    const projectDir = join(treeRoot, "projects", projectName);
    mkdirSync(projectDir, { recursive: true });
    mkdirSync(join(treeRoot, "file-history"));
    return { treeRoot, projectDir };
}

// Serialize fabricated records one-per-line into <projectDir>/<name> and load them back through loadTranscript so every record carries its on-disk source stamp.
export function writeTranscriptFixture(projectDir: string, name: string, records: object[]): TranscriptRecord[] {
    const jsonlPath = join(projectDir, name);
    writeFileSync(jsonlPath, records.map((record) => JSON.stringify(record)).join("\n") + "\n");
    return loadTranscript(jsonlPath).records;
}

// The envelope fields shared by both halves of a tool-call record pair.
export type RecordEnvelope = {
    sessionId: string;
    cwd: string;
    timestamp: string;
    toolId: string;
    parentUuid: string | null;
};

// One structuredPatch hunk (the wire shape of an Edit result's patch entry).
export type WireHunk = { oldStart: number; oldLines: number; newStart: number; newLines: number; lines: string[] };

// The assistant record holding one tool_use block.
function buildAssistantToolUseRecord(envelope: RecordEnvelope, toolName: string, input: object): object {
    const toolUseBlock = { type: "tool_use", id: envelope.toolId, name: toolName, input };
    return {
        type: "assistant",
        uuid: `${envelope.toolId}-assistant`,
        parentUuid: envelope.parentUuid,
        sessionId: envelope.sessionId,
        timestamp: envelope.timestamp,
        cwd: envelope.cwd,
        message: { role: "assistant", content: [toolUseBlock] },
    };
}

// The user record reporting that tool call's result.
function buildUserToolResultRecord(envelope: RecordEnvelope, resultText: string, toolUseResult: object | string): object {
    const toolResultBlock = { tool_use_id: envelope.toolId, type: "tool_result", content: resultText };
    return {
        type: "user",
        uuid: `${envelope.toolId}-result`,
        parentUuid: `${envelope.toolId}-assistant`,
        sessionId: envelope.sessionId,
        timestamp: envelope.timestamp,
        cwd: envelope.cwd,
        message: { role: "user", content: [toolResultBlock] },
        toolUseResult,
    };
}

export type RecordPair = { records: object[]; lastUuid: string };

// The pair for a tool run that FAILED: real transcripts report a plain string toolUseResult ("Error: File does not exist.", "User rejected tool use") instead of a structured payload.
export function buildErroredToolResultRecordPair(
    envelope: RecordEnvelope,
    toolName: string,
    toolInput: object,
    errorText: string,
): RecordPair {
    return {
        records: [
            buildAssistantToolUseRecord(envelope, toolName, toolInput),
            buildUserToolResultRecord(envelope, errorText, errorText),
        ],
        lastUuid: `${envelope.toolId}-result`,
    };
}

// A genuine typed-in user prompt record (string message content, no tool_result, not meta) — the turn-boundary shape the task-193 bound tests cut at. isSidechain marks a subagent's opening prompt, which is NOT a turn boundary; sessionId defaults to SESSION_A.
export function buildPromptRecord(
    uuid: string,
    parentUuid: string | null,
    timestamp: string,
    cwd: string,
    options?: { isSidechain?: boolean; sessionId?: string },
): object {
    const record: Record<string, unknown> = {
        type: "user",
        uuid,
        parentUuid,
        sessionId: options?.sessionId ?? SESSION_A,
        timestamp,
        cwd,
        message: { role: "user", content: "next task" },
    };
    if (options?.isSidechain === true) {
        record.isSidechain = true;
    }
    return record;
}

// The assistant tool_use + user toolUseResult pair for one Write.
export function buildWriteRecordPair(envelope: RecordEnvelope, filePath: string, content: string): RecordPair {
    const writeResult = {
        type: "create",
        filePath,
        content,
        structuredPatch: [],
        originalFile: null,
        userModified: false,
    };
    return {
        records: [
            buildAssistantToolUseRecord(envelope, "Write", { file_path: filePath, content }),
            buildUserToolResultRecord(envelope, "created", writeResult),
        ],
        lastUuid: `${envelope.toolId}-result`,
    };
}

// The pair for one Edit (an "update" result with structuredPatch + originalFile — the §a content-gate evidence). originalFile: null models a result that reports no pre-edit content (task 198's byteless-Edit class).
export function buildEditRecordPair(
    envelope: RecordEnvelope,
    filePath: string,
    postContent: string,
    originalFile: string | null,
    hunk: WireHunk,
): RecordPair {
    const editResult = {
        type: "update",
        filePath,
        content: postContent,
        structuredPatch: [hunk],
        originalFile,
        userModified: false,
    };
    return {
        records: [
            buildAssistantToolUseRecord(envelope, "Edit", { file_path: filePath, old_string: "", new_string: "" }),
            buildUserToolResultRecord(envelope, "updated", editResult),
        ],
        lastUuid: `${envelope.toolId}-result`,
    };
}

// The echoed window of a Read result: which lines came back and how many the file holds.
export type ReadWindow = { startLine: number; numLines: number; totalLines: number };

// The pair for one Read (a "text" result whose file block carries the echo window — task 198's complete-vs-partial Read echo evidence).
export function buildReadRecordPair(
    envelope: RecordEnvelope,
    filePath: string,
    content: string,
    window: ReadWindow,
): RecordPair {
    const readResult = {
        type: "text",
        file: { filePath, content, numLines: window.numLines, startLine: window.startLine, totalLines: window.totalLines },
    };
    return {
        records: [
            buildAssistantToolUseRecord(envelope, "Read", { file_path: filePath }),
            buildUserToolResultRecord(envelope, "read", readResult),
        ],
        lastUuid: `${envelope.toolId}-result`,
    };
}

export type TwoSourceFixture = {
    listA: TranscriptRecord[];
    listB: TranscriptRecord[];
    sources: SourceEntry[];
    rootA: string;
    rootB: string;
    alphaPath: string;
    betaPath: string;
};

// Two source trees with declared roots: source A's session writes <rootA>/app.py "line one" at 10:00; source B's session edits <rootB>/app.py at 10:05 whose originalFile is the given evidence. buildExtraRecordsA (optional) receives A's computed locations and returns further records appended onto A's transcript (for interleave shapes) — a callback because the temp paths only exist once the trees are made.
export function makeTwoSourceEditFixture(
    originalFileSeenByB: string,
    buildExtraRecordsA?: (locations: { rootA: string; alphaPath: string }) => object[],
): TwoSourceFixture {
    const treeA = makeSourceTree("-alpha-project");
    const treeB = makeSourceTree("-beta-project");
    const rootA = join(treeA.treeRoot, "workspace-alpha");
    const rootB = join(treeB.treeRoot, "workspace-beta");
    const alphaPath = join(rootA, "app.py");
    const betaPath = join(rootB, "app.py");
    const write = buildWriteRecordPair(
        { sessionId: SESSION_A, cwd: rootA, timestamp: "2026-07-22T10:00:00.000Z", toolId: "toolu_write_a1", parentUuid: null },
        alphaPath,
        "line one\n",
    );
    const edit = buildEditRecordPair(
        { sessionId: SESSION_B, cwd: rootB, timestamp: "2026-07-22T10:05:00.000Z", toolId: "toolu_edit_b1", parentUuid: null },
        betaPath,
        "line one\nline two\n",
        originalFileSeenByB,
        { oldStart: 1, oldLines: 1, newStart: 1, newLines: 2, lines: [" line one", "+line two"] },
    );
    const extraRecordsA = buildExtraRecordsA === undefined ? [] : buildExtraRecordsA({ rootA, alphaPath });
    const listA = writeTranscriptFixture(treeA.projectDir, "a.jsonl", [...write.records, ...extraRecordsA]);
    const listB = writeTranscriptFixture(treeB.projectDir, "b.jsonl", edit.records);
    const sources: SourceEntry[] = [
        { projectsDir: new Path(join(treeA.treeRoot, "projects")), root: new Path(rootA) },
        { projectsDir: new Path(join(treeB.treeRoot, "projects")), root: new Path(rootB) },
    ];
    return { listA, listB, sources, rootA, rootB, alphaPath, betaPath };
}
