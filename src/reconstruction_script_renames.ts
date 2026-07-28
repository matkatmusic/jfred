// Renames inside an executed script leave no tool_use event; the printed `old -> new` mapping
// is the only in-transcript evidence, so this module parses that stdout into rename events.

import { getContentBlocks, type ContentBlock } from "./structures/content-blocks.ts";
import type { TranscriptRecord } from "./structures/envelope.ts";
import { BlockType, EventKind, EXECUTOR_TOOL_NAMES, ToolName } from "./structures/vocabulary.ts";
import { Path, type Uuid } from "./structures/domain.ts";
import { resolveAgainstCwd } from "./structures/path-resolve.ts";
import type { FileEvent } from "./reconstruction_engine.ts";
import { codeLiteralMoveCall, renameArrowLine } from "./regex_expressions.ts";
import { isJunkStateKey } from "./reconstruction_script_sandbox.ts";

// A shutil.move reports both sides as changed paths, but it is ONE move.
export type ScriptRenameKeyPair = { fromKey: string; toKey: string };

// Junk keys never pair, and a key present in both states is a modification, never a rename side.
export function matchRenamePairs(pre: Map<string, string>, post: Map<string, string>): ScriptRenameKeyPair[] {
    const deletedKeys: string[] = [];
    for (const key of pre.keys()) {
        if (post.has(key) || isJunkStateKey(key)) continue;
        deletedKeys.push(key);
    }
    const pairs: ScriptRenameKeyPair[] = [];
    const claimedSourceKeys = new Set<string>();
    for (const key of post.keys()) {
        if (pre.has(key) || isJunkStateKey(key)) continue;
        const sourceKey = deletedKeys.find((deleted) => !claimedSourceKeys.has(deleted) && pre.get(deleted) === post.get(key));
        if (sourceKey === undefined) continue;
        claimedSourceKeys.add(sourceKey);
        pairs.push({ fromKey: sourceKey, toKey: key });
    }
    return pairs;
}

type ExecutorRun = { id: Uuid; timestamp: Date; cwd: Path | undefined; code: string | undefined };

// Both evidence channels pool here so the guard rules in EXECUTOR-timestamp order, not readdir order.
type RenameCandidate = { changeId: Uuid; from: Path; to: Path; timestamp: Date };

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

// Candidates stamp at the RESULT instant, not the tool_use's: a consent-delayed MCP move can sit
// pending for minutes, and only by the result instant has the execution provably finished.
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

// A rename's source basename must be a Write/Edit target or an already-accepted rename's destination,
// so a chained rename is accepted no matter which record loaded first.
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
    // MCP carries input.cwd/input.code; Bash uses the record cwd.
    const executors = new Map<string, ExecutorRun>();
    // Phantom guard: a rename source must be a basename some Write/Edit targeted.
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
