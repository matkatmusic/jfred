// Tool-call record pairs (assistant tool_use + user tool_result) in the captured wire shape.

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

// The pair for a failed tool run: real transcripts report a plain string toolUseResult.
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

// The pair for one Edit; originalFile null models a result that reports no pre-edit content.
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

// The pair for one Read; the file block carries the echo window.
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
