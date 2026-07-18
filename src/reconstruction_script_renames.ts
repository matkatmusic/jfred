// Script-run rename recovery: renames performed inside an executed script (Bash or MCP
// ctx_execute) leave no per-record tool_use event; the only in-transcript evidence is the
// `old -> new` mapping the script prints. This module parses that printed stdout into
// rename events. Extraction proper (records -> events) lives in reconstruction_extract.ts.

import { getContentBlocks, type ContentBlock } from "./structures/content-blocks.ts";
import type { TranscriptRecord } from "./structures/envelope.ts";
import { BlockType, EventKind, EXECUTOR_TOOL_NAMES, ToolName } from "./structures/vocabulary.ts";
import { Path, type Uuid } from "./structures/domain.ts";
import { resolveAgainstCwd } from "./structures/path-resolve.ts";
import type { FileEvent } from "./reconstruction_engine.ts";
import { codeLiteralMoveCall, renameArrowLine } from "./regex_expressions.ts";

// One executor tool_use as the rename channels need it: its id (the changeId of any rename it
// evidences), run instant, cwd for path resolution, and — for MCP ctx_execute — its script code.
type ExecutorRun = { id: Uuid; timestamp: Date; cwd: Path | undefined; code: string | undefined };

// One possible rename before the phantom guard has ruled on it: resolved endpoints stamped at the
// run instant. Candidates from BOTH evidence channels (printed stdout, code literals) pool here so
// the guard can rule in EXECUTOR-timestamp order, not record (readdir) order.
type RenameCandidate = { changeId: Uuid; from: Path; to: Path; timestamp: Date };

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
// One tool_use block's contribution to the pre-scan: Write/Edit targets feed the written-basename
// guard set; executor runs register their run instant and cwd under the block's tool_use id.
function collectExecutorAndWrittenBasename(block: ContentBlock, timestamp: Date | undefined, recordCwd: Path | undefined, executors: Map<string, ExecutorRun>, writtenBasenames: Set<string>): void {
    if (block.type !== BlockType.tool_use) {
        return;
    }
    if (block.name === ToolName.Write || block.name === ToolName.Edit) {
        const filePath = (block.input as { file_path?: string }).file_path;
        if (filePath !== undefined) {
            writtenBasenames.add(basenameOf(filePath));
        }
    }
    if (EXECUTOR_TOOL_NAMES.has(block.name) && timestamp instanceof Date) {
        const cwd = (block.input as { cwd?: string }).cwd;
        const code = (block.input as { code?: string }).code;
        executors.set(block.id.toString(), { id: block.id, timestamp, cwd: cwd !== undefined ? new Path(cwd) : recordCwd, code });
    }
}

// One tool_result block: mark its run COMPLETED (the result is the proof the code actually ran)
// and parse the printed `old -> new` lines of a known executor run into rename CANDIDATES.
// The written-source phantom guard no longer rules here — records load in readdir order, not
// execution order, so a chained rename could be judged before the run that wrote its source.
// acceptRenameCandidatesInTimestampOrder rules once all candidates are pooled.
// Candidates stamp at the RESULT record's instant, not the tool_use's: the tool_use instant is
// only when the run was REQUESTED — s87's consent-delayed MCP move sat pending for 6 minutes
// while interleaved Bash runs proved the file had not moved yet. By the result instant the
// execution has provably finished, so every interleaved event orders before it.
function collectRenameCandidatesFromToolResult(block: ContentBlock, record: TranscriptRecord, executors: Map<string, ExecutorRun>, completionInstantByExecutorId: Map<string, Date>, candidates: RenameCandidate[]): void {
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
    for (const match of toolResultText(record).matchAll(renameArrowLine)) {
        const [, from, to] = match;
        // ponytail: guard moved — see acceptRenameCandidatesInTimestampOrder
        // if (!writtenBasenames.has(basenameOf(from!))) {
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

// The code-literal channel (s87 step 89): a COMPLETED run whose code contains a two-string-literal
// `shutil.move("a.py", "b.py")` / `os.rename(...)` call evidences that rename even when the run
// prints no arrow line. Uncompleted runs contribute nothing (never fabricate); the variable form
// `shutil.move(src, dst)` never matches the literal regex.
function collectRenameCandidatesFromCompletedRunCode(executor: ExecutorRun, completionInstantByExecutorId: Map<string, Date>, candidates: RenameCandidate[]): void {
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

// Rule on the pooled candidates in EXECUTOR-timestamp order with a chain-aware phantom guard:
// a rename's source basename must be a Write/Edit target OR the destination of an already-accepted
// (earlier) rename — so run 2 moving run 1's move-born destination is accepted no matter which
// record loaded first. A (changeId, from, to) seen twice (a run evidencing the same move via both
// channels) counts once.
function acceptRenameCandidatesInTimestampOrder(candidates: RenameCandidate[], writtenBasenames: Set<string>): FileEvent[] {
    const sortedCandidates = [...candidates].sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
    const knownSourceBasenames = new Set(writtenBasenames);
    const seenCandidateKeys = new Set<string>();
    const events: FileEvent[] = [];
    for (const candidate of sortedCandidates) {
        const candidateKey = `${candidate.changeId.toString()}|${candidate.from.toString()}|${candidate.to.toString()}`;
        if (seenCandidateKeys.has(candidateKey)) {
            continue;
        }
        seenCandidateKeys.add(candidateKey);
        if (!knownSourceBasenames.has(basenameOf(candidate.from.toString()))) {
            continue;
        }
        knownSourceBasenames.add(basenameOf(candidate.to.toString()));
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

export function extractScriptRenameEvents(records: TranscriptRecord[]): FileEvent[] {
    // executor tool_use id -> its run instant, cwd, and code (MCP carries input.cwd/input.code; Bash uses the record cwd).
    const executors = new Map<string, ExecutorRun>();
    // basenames of every file a Write/Edit targeted — a rename source must be one of these (phantom guard).
    const writtenBasenames = new Set<string>();
    for (const record of records) {
        const timestamp = record.timestamp;
        const recordCwd = (record as { cwd?: Path }).cwd;
        for (const block of getContentBlocks(record)) {
            collectExecutorAndWrittenBasename(block, timestamp, recordCwd, executors, writtenBasenames);
        }
    }
    const completionInstantByExecutorId = new Map<string, Date>();
    const candidates: RenameCandidate[] = [];
    for (const record of records) {
        for (const block of getContentBlocks(record)) {
            collectRenameCandidatesFromToolResult(block, record, executors, completionInstantByExecutorId, candidates);
        }
    }
    for (const executor of executors.values()) {
        collectRenameCandidatesFromCompletedRunCode(executor, completionInstantByExecutorId, candidates);
    }
    return acceptRenameCandidatesInTimestampOrder(candidates, writtenBasenames);
}
