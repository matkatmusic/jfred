// The timeline's parsed git operations (item 66: kind + detail + commit-hash pill), extracted
// from the transcript's Bash commands. The `git commit` EVENT extraction lives in
// reconstruction_git_commit_events.ts (250-line split), importing this file's segment splitter.

import { BlockType, GitOperationKind, KNOWN_GIT_OPERATION_KINDS, ToolName } from "./structures/vocabulary.ts";
import { Uuid } from "./structures/domain.ts";
import type { TranscriptRecord } from "./structures/envelope.ts";
import { getContentBlocks } from "./structures/content-blocks.ts";
import { bareCommitHashToken, gitCommandStart, gitCommitResultHashLine, shellCommandToken } from "./regex_expressions.ts";

// A compound Bash command's `&&`-chained segments, each trimmed — `git add a && git commit -m "x"`
// -> ["git add a", 'git commit -m "x"']. A command with no `&&` comes back as its own single
// segment. Task 89: each git segment then gets its own operation/commit-event.
// ponytail: a literal `&&` INSIDE a quoted argument would split wrongly — no transcript
// exercises that; move to a quote-aware scan if one ever does.
export function splitCompoundCommandSegments(command: string): string[] {
    return command.split("&&").map((segment) => segment.trim());
}

// One recorded git command, parsed for the timeline: the subcommand family, the human detail its
// row shows (commit message, add paths, branch name), the verbatim command, when/which session
// ran it (for turn attribution), and the Bash record's own uuid (the viewer resolves the
// command's JSONL line through it).
export type GitOperation = {
    kind: GitOperationKind;
    detail: string;
    command: string;
    timestamp: Date;
    sessionId: Uuid | undefined;
    uuid: Uuid | undefined;
    // The short commit hash from the commit's own tool_result text (`[master 4fa08d2] …`), only on
    // kind commit and only when the output carried git's summary line — the viewer's commit pill.
    // A git hash abbreviation is free-form text, so it stays a primitive (coding-requirements 1).
    resultHash?: string;
    // True when the Bash call's own tool_result carried is_error (task 103) — the timeline's red
    // FAILED badge; failed commands are badged, never suppressed. A compound's single result
    // serves every segment, so ALL its git segments carry the stamp (the shell stopped at the
    // failing segment; the transcript cannot attribute the failure per segment). Absent on
    // success (the resultHash stamped-only-when-present convention).
    isError?: boolean;
};

// Global git flags that consume the NEXT token as their argument (`git -C <dir> …`,
// `git -c key=val …`) — skipped, argument included, when locating the subcommand.
const GIT_FLAGS_WITH_ARGUMENT = new Set(["-C", "-c"]);

// The index of the subcommand token: the first token after `git` that is not a global flag.
// tokens.length when the command has flags but no subcommand.
function findSubcommandIndex(tokens: string[]): number {
    let index = 1;
    while (index < tokens.length) {
        const token = tokens[index]!;
        if (GIT_FLAGS_WITH_ARGUMENT.has(token)) {
            index += 2;
            continue;
        }
        if (token.startsWith("-")) {
            index += 1;
            continue;
        }
        return index;
    }
    return tokens.length;
}

// The wire kind for a subcommand word: its GitOperationKind member, or `other` for any
// subcommand outside the annotated set (this is the hydration point — wire word -> enum member).
function parseGitOperationKind(subcommand: string | undefined): GitOperationKind {
    const known = KNOWN_GIT_OPERATION_KINDS.find((kind) => kind === subcommand);
    if (known === undefined) return GitOperationKind.other;
    return known;
}

// `token` without its surrounding quote pair, when it has one ("baseline" -> baseline).
// ponytail: escaped quotes inside the token are left as-is — no fixture exercises them.
function stripSurroundingQuotes(token: string): string {
    if (token.length < 2) return token;
    const first = token[0]!;
    const last = token[token.length - 1]!;
    if (first !== last) return token;
    if (first === '"') return token.slice(1, -1);
    if (first === "'") return token.slice(1, -1);
    return token;
}

// The first argument that is not a flag, or "" — a branch/checkout command's branch name.
function findFirstNonFlagArgument(argumentTokens: string[]): string {
    const found = argumentTokens.find((token) => !token.startsWith("-"));
    if (found === undefined) return "";
    return found;
}

// The row detail for one parsed command: commit -> its first -m message; add -> its path
// arguments; branch/checkout -> the branch name; anything else -> "".
function parseGitOperationDetail(kind: GitOperationKind, tokens: string[], subcommandIndex: number): string {
    const argumentTokens = tokens.slice(subcommandIndex + 1);
    if (kind === GitOperationKind.commit) {
        const messageFlagIndex = argumentTokens.indexOf("-m");
        if (messageFlagIndex < 0) return "";
        const message = argumentTokens[messageFlagIndex + 1];
        if (message === undefined) return "";
        return stripSurroundingQuotes(message);
    }
    if (kind === GitOperationKind.add) {
        return argumentTokens.filter((token) => !token.startsWith("-")).join(" ");
    }
    if (kind === GitOperationKind.branch) {
        return findFirstNonFlagArgument(argumentTokens);
    }
    if (kind === GitOperationKind.checkout) {
        return findFirstNonFlagArgument(argumentTokens);
    }
    return "";
}

// One Bash command's tool_result, as the operation parse reads it: the printed output text (the
// commit-hash source) and whether the call errored (task 103's FAILED stamp).
type GitCommandResult = { text: string; isError: boolean };

// One Bash command's operations: one per `&&` segment that IS a git invocation. Commit segments
// read their short hash from the result's text — the compound's single tool_result serves every
// segment — and an errored result stamps isError on every git segment (task 103).
function parseOperationsFromCommand(
    command: string,
    timestamp: Date,
    sessionId: Uuid | undefined,
    uuid: Uuid | undefined,
    result: GitCommandResult | undefined,
): GitOperation[] {
    const operations: GitOperation[] = [];
    for (const segment of splitCompoundCommandSegments(command)) {
        if (segment.match(gitCommandStart) === null) continue;
        const operation = parseGitOperation(segment, timestamp, sessionId, uuid);
        if (operation.kind === GitOperationKind.commit && result !== undefined) {
            operation.resultHash = extractCommitHashFromResultText(result.text);
        }
        if (result !== undefined && result.isError) {
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
    const tokens = command.match(shellCommandToken) ?? [];
    const subcommandIndex = findSubcommandIndex(tokens);
    const kind = parseGitOperationKind(tokens[subcommandIndex]);
    return {
        kind,
        detail: parseGitOperationDetail(kind, tokens, subcommandIndex),
        command,
        timestamp,
        sessionId,
        uuid,
    };
}

// The short hash in a commit's tool_result text — git's `[branch hash] message` summary line
// (`[master 4fa08d2] fix: x`, `[master (root-commit) ab12cd3] init`) — falling back to a
// whole-word hex token when the summary was piped away but the hash still got printed
// (scenario captures echo `ok 928eaa9`); undefined when neither form is present.
export function extractCommitHashFromResultText(resultText: string): string | undefined {
    const summaryMatch = resultText.match(gitCommitResultHashLine);
    if (summaryMatch !== null) return summaryMatch[1];
    const bareTokenMatch = resultText.match(bareCommitHashToken);
    if (bareTokenMatch === null) return undefined;
    return bareTokenMatch[1];
}

// Every tool_result's text + error flag, keyed by its tool_use id — the lookup an operation
// resolves its own printed output and failure through (same hydrated-block pattern as
// reconstruction_extract's result walk).
function indexToolResultsByToolUseId(records: TranscriptRecord[]): Map<string, GitCommandResult> {
    const resultById = new Map<string, GitCommandResult>();
    for (const record of records) {
        for (const block of getContentBlocks(record)) {
            if (block.type !== BlockType.tool_result) continue;
            if (typeof block.content !== "string") continue;
            resultById.set(block.tool_use_id.toString(), { text: block.content, isError: block.is_error });
        }
    }
    return resultById;
}

// Every git Bash command in the transcript, in record order, parsed for the timeline's
// `* git <kind> <detail> *` rows. A compound `&&`-chained command contributes one operation per
// git segment (task 89: the chained commit gets its own row). Reads the transcript records
// directly — the consent scan's ScriptRun list serves script consent, not git history. Commit
// operations additionally carry the short hash printed in their own tool_result (item 66: the
// viewer's `GIT COMMIT [hash]` pill).
export function findGitOperations(records: TranscriptRecord[]): GitOperation[] {
    const resultById = indexToolResultsByToolUseId(records);
    const operations: GitOperation[] = [];
    for (const record of records) {
        const timestamp = record.timestamp;
        if (!(timestamp instanceof Date)) continue;
        for (const block of getContentBlocks(record)) {
            if (block.type !== BlockType.tool_use) continue;
            if (block.name !== ToolName.Bash) continue;
            const command = (block.input as { command?: string }).command;
            if (command === undefined) continue;
            const result = resultById.get(block.id.toString());
            operations.push(...parseOperationsFromCommand(command, timestamp, record.sessionId, record.uuid, result));
        }
    }
    return operations;
}
