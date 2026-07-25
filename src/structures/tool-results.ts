import type { TranscriptRecord } from "./envelope.ts";
import { getContentBlocks } from "./content-blocks.ts";
import { BlockType, ToolName } from "./vocabulary.ts";
import { Path } from "./domain.ts";

// tool_use.input shapes (recon/08, recon/09; Read/Edit from s2). file_path is a
// Path; input hydration has no consumer yet, so these are declared but not
// constructed.
export type BashInput = { command: string; description: string };
export type WriteInput = { content: string; file_path: Path };
export type ReadInput = { file_path: Path };
export type EditInput = {
    file_path: Path;
    old_string: string;
    new_string: string;
    replace_all: boolean;
};

// toolUseResult shapes (recon/07, recon/09).
export type BashResult = {
    interrupted: boolean;
    isImage: boolean;
    noOutputExpected: boolean;
    stderr: string;
    stdout: string;
};

// A unified-diff hunk inside a structuredPatch. s1 produced none (a create has
// no diff); s2-move-file's Edit results reveal the shape. Line ranges are plain
// numbers and `lines` is the raw diff text (`+`/`-`/` ` prefixed) — free-form
// values with no narrower domain type.
export type StructuredPatchHunk = {
    oldStart: number;
    oldLines: number;
    newStart: number;
    newLines: number;
    lines: string[];
};

export type WriteResult = {
    content: string;
    filePath: Path;
    originalFile: string | null;
    structuredPatch: StructuredPatchHunk[];
    type: string;
    userModified: boolean;
};

// The Read result wraps the file's content and line metadata in a nested `file`
// object (recon: s2). filePath is hydrated into a Path.
export type ReadFile = {
    filePath: Path;
    content: string;
    numLines: number;
    startLine: number;
    totalLines: number;
};

export type ReadResult = {
    type: string;
    file: ReadFile;
};

// The Edit result carries the before/after strings and a non-empty
// structuredPatch (recon: s2). filePath is hydrated into a Path; originalFile is
// present as a string in s2 (a later scenario may omit it — see s2 notes).
export type EditResult = {
    filePath: Path;
    oldString: string;
    newString: string;
    originalFile: string;
    structuredPatch: StructuredPatchHunk[];
    userModified: boolean;
    replaceAll: boolean;
};

export type ResolvedToolResult =
    | { toolName: ToolName.Bash; result: BashResult }
    | { toolName: ToolName.Write; result: WriteResult }
    | { toolName: ToolName.Read; result: ReadResult }
    | { toolName: ToolName.Edit; result: EditResult };

// Thrown when a tool result resolves to a tool name outside the s1 vocabulary,
// so an unmodeled tool's result cannot pass silently (fog-of-war guard).
export class UnknownToolNameError extends Error {
    readonly toolName: string;

    constructor(toolName: string) {
        super(`Unknown tool name: ${toolName}`);
        this.name = "UnknownToolNameError";
        this.toolName = toolName;
    }
}

function addToolUseNames(
    record: TranscriptRecord,
    nameById: Map<string, string>,
): void {
    for (const block of getContentBlocks(record)) {
        if (block.type === BlockType.tool_use) {
            nameById.set(block.id.toString(), block.name);
        }
    }
}

// Build a map from tool_use id -> tool name across all assistant records, so a
// tool result (which references a tool_use_id) can be attributed to its tool.
export function indexToolUseNamesById(
    records: TranscriptRecord[],
): Map<string, string> {
    const nameById = new Map<string, string>();
    for (const record of records) {
        addToolUseNames(record, nameById);
    }
    return nameById;
}

// The tool name behind this user record's tool_result block, or undefined when the record
// carries none (exported for callers that must filter by tool BEFORE resolving — resolution
// throws UnknownToolNameError on unmodeled tools by design).
export function resolveToolNameForRecord(
    record: TranscriptRecord,
    nameById: Map<string, string>,
): string | undefined {
    for (const block of getContentBlocks(record)) {
        if (block.type === BlockType.tool_result) {
            return nameById.get(block.tool_use_id.toString());
        }
    }
    return undefined;
}

// Hydrate a Write result's filePath from its wire string into a Path; the rest
// of the fields are content/flags with no narrower domain type.
function hydrateWriteResult(raw: unknown): WriteResult {
    const result = raw as WriteResult & { filePath: string };
    return { ...result, filePath: new Path(result.filePath) };
}

// Hydrate a Read result's nested file.filePath into a Path, returning a fresh
// object so the raw record is never mutated.
function hydrateReadResult(raw: unknown): ReadResult {
    const result = raw as ReadResult & { file: ReadFile & { filePath: string } };
    return {
        ...result,
        file: { ...result.file, filePath: new Path(result.file.filePath) },
    };
}

// Hydrate an Edit result's filePath into a Path; structuredPatch and the
// before/after strings are free-form values carried through unchanged.
function hydrateEditResult(raw: unknown): EditResult {
    const result = raw as EditResult & { filePath: string };
    return { ...result, filePath: new Path(result.filePath) };
}

function resolveToolResult(toolName: string, raw: unknown): ResolvedToolResult {
    if (toolName === ToolName.Bash) {
        return { toolName: ToolName.Bash, result: raw as BashResult };
    }
    if (toolName === ToolName.Write) {
        return { toolName: ToolName.Write, result: hydrateWriteResult(raw) };
    }
    if (toolName === ToolName.Read) {
        return { toolName: ToolName.Read, result: hydrateReadResult(raw) };
    }
    if (toolName === ToolName.Edit) {
        return { toolName: ToolName.Edit, result: hydrateEditResult(raw) };
    }
    throw new UnknownToolNameError(toolName);
}

// Resolve and type the tool result attached to a user record, or undefined when
// the record carries no toolUseResult, no resolvable tool name, or an errored run.
export function getToolResultForUserRecord(
    record: TranscriptRecord,
    nameById: Map<string, string>,
): ResolvedToolResult | undefined {
    const raw = record.toolUseResult;
    if (!raw) {
        return undefined;
    }
    // An errored or rejected run reports a plain string ("Error: File does not exist.",
    // "User rejected tool use") instead of a structured payload — nothing to type.
    if (typeof raw === "string") {
        return undefined;
    }
    const toolName = resolveToolNameForRecord(record, nameById);
    if (toolName === undefined) {
        return undefined;
    }
    return resolveToolResult(toolName, raw);
}

