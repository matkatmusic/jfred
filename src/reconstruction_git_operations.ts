// Parsed git operations for the timeline; commit events live in reconstruction_git_commit_events.ts.

import { BlockType, GitOperationKind, KNOWN_GIT_OPERATION_KINDS, ToolName } from "./structures/vocabulary.ts";
import { Uuid } from "./structures/domain.ts";
import type { TranscriptRecord } from "./structures/envelope.ts";
import { getContentBlocks } from "./structures/content-blocks.ts";
import { bareCommitHashToken, gitCommandStart, gitCommitResultHashLine, shellCommandToken } from "./regex_expressions.ts";

// Splits a `&&`-chained command into trimmed segments (task 89).
// ponytail: a literal `&&` INSIDE a quoted argument would split wrongly — no transcript exercises that; move to a quote-aware scan if one ever does.
export function splitCompoundCommandSegments(command: string): string[] {
    return command.split("&&").map((segment) => segment.trim());
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

// Git flags like `-C` and `-c` that consume the next token as their argument.
const GIT_FLAGS_WITH_ARGUMENT = new Set(["-C", "-c"]);

// Index of the first token after `git` that is not a global flag.
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

// Maps a subcommand word to its GitOperationKind, defaulting to `other`.
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

// Extracts the human-readable detail string for a git operation's kind.
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

// Extracts short commit hash from tool_result summary line or bare hex token.
export function extractCommitHashFromResultText(resultText: string): string | undefined {
    const summaryMatch = resultText.match(gitCommitResultHashLine);
    if (summaryMatch !== null) return summaryMatch[1];
    const bareTokenMatch = resultText.match(bareCommitHashToken);
    if (bareTokenMatch === null) return undefined;
    return bareTokenMatch[1];
}

// Index tool_result text and error flag by tool_use id for operation lookup.
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

// Extracts every git operation from transcript Bash records for the timeline.
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
