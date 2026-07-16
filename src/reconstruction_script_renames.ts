// Script-run rename recovery: renames performed inside an executed script (Bash or MCP
// ctx_execute) leave no per-record tool_use event; the only in-transcript evidence is the
// `old -> new` mapping the script prints. This module parses that printed stdout into
// rename events. Extraction proper (records -> events) lives in reconstruction_extract.ts.

import { getContentBlocks } from "./structures/content-blocks.ts";
import type { TranscriptRecord } from "./structures/envelope.ts";
import { BlockType, EventKind, EXECUTOR_TOOL_NAMES, ToolName } from "./structures/vocabulary.ts";
import { Path } from "./structures/domain.ts";
import { resolveAgainstCwd } from "./structures/path-resolve.ts";
import type { FileEvent } from "./reconstruction_engine.ts";
import { renameArrowLine } from "./regex_expressions.ts";

// The plain text of an executor's tool result across the shapes it takes: a Bash result object (`.stdout`),
// an MCP ctx_execute result (an array of `{type:"text", text}` blocks), or a bare string.
function toolResultText(record: TranscriptRecord): string {
    const raw = (record as { toolUseResult?: unknown }).toolUseResult;
    if (typeof raw === "string") {
        return raw;
    }
    if (Array.isArray(raw)) {
        const blockTexts = raw.map((block) => (block && typeof block === "object" && "text" in block ? String((block as { text: unknown }).text) : ""));
        return blockTexts.join("\n");
    }
    if (raw && typeof raw === "object" && typeof (raw as { stdout?: unknown }).stdout === "string") {
        return (raw as { stdout: string }).stdout;
    }
    return "";
}

// The final path segment of a "/"-separated path string.
function basenameOf(value: string): string {
    const slash = value.lastIndexOf("/");
    return slash >= 0 ? value.slice(slash + 1) : value;
}

// Renames performed by an EXECUTED script (Bash or MCP ctx_execute), recovered from the run's printed stdout:
// the transcript captures each `old -> new` line the script prints. A `shutil.move`/`os.rename` inside the
// code is invisible to extraction (it is not a Bash `mv`), so the printed mapping is the only in-transcript
// evidence of the move; parsing it into rename events lets the renamed-to path reconstruct as its source's
// lineage (buildRenameChain/distinctFinalPaths). Two guards keep it honest: the source basename must have been
// written/edited earlier (drops coincidental `x.y -> z.y` prose), and `renameArrowLine` only accepts
// dot-extension filenames on BOTH sides — so a function-rename print (`f_one -> alpha`) and the echoed
// f-string code (`{name}.py -> …`) never match.
export function extractScriptRenameEvents(records: TranscriptRecord[]): FileEvent[] {
    // executor tool_use id -> its run instant and cwd (MCP carries input.cwd; Bash uses the record cwd).
    const executors = new Map<string, { timestamp: Date; cwd: Path | undefined }>();
    // basenames of every file a Write/Edit targeted — a rename source must be one of these (phantom guard).
    const writtenBasenames = new Set<string>();
    for (const record of records) {
        const timestamp = record.timestamp;
        const recordCwd = (record as { cwd?: Path }).cwd;
        for (const block of getContentBlocks(record)) {
            if (block.type !== BlockType.tool_use) {
                continue;
            }
            if (block.name === ToolName.Write || block.name === ToolName.Edit) {
                const filePath = (block.input as { file_path?: string }).file_path;
                if (filePath !== undefined) {
                    writtenBasenames.add(basenameOf(filePath));
                }
            }
            if (EXECUTOR_TOOL_NAMES.has(block.name) && timestamp instanceof Date) {
                const cwd = (block.input as { cwd?: string }).cwd;
                executors.set(block.id.toString(), { timestamp, cwd: cwd !== undefined ? new Path(cwd) : recordCwd });
            }
        }
    }
    const events: FileEvent[] = [];
    for (const record of records) {
        for (const block of getContentBlocks(record)) {
            if (block.type !== BlockType.tool_result) {
                continue;
            }
            const executor = executors.get(block.tool_use_id.toString());
            if (executor === undefined) {
                continue;
            }
            for (const match of toolResultText(record).matchAll(renameArrowLine)) {
                const [, from, to] = match;
                if (!writtenBasenames.has(basenameOf(from!))) {
                    continue;
                }
                events.push({
                    kind: EventKind.rename,
                    changeId: block.tool_use_id,
                    from: new Path(resolveAgainstCwd(executor.cwd, new Path(from!))),
                    to: new Path(resolveAgainstCwd(executor.cwd, new Path(to!))),
                    timestamp: executor.timestamp,
                });
            }
        }
    }
    return events;
}
