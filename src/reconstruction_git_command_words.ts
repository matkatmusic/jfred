// Reads the kind and detail text out of one git command string.

import { GitOperationKind, KNOWN_GIT_OPERATION_KINDS } from "./structures/vocabulary_views.ts";
import { shellCommandToken } from "./regex_expressions.ts";

// Git flags like `-C` and `-c` that consume the next token as their argument.
const GIT_FLAGS_WITH_ARGUMENT = new Set(["-C", "-c"]);

// Index of the first token after `git` that is not a global flag.
function findSubcommandIndex(tokens: string[]): number {
  let index = 1;
  while (index < tokens.length) {
    const token = tokens[index]!;
    const takesArgument = GIT_FLAGS_WITH_ARGUMENT.has(token);
    if (takesArgument) {
      index += 2;
      continue;
    }
    const isFlag = token.startsWith("-");
    if (isFlag) {
      index += 1;
      continue;
    }
    return index;
  }
  return tokens.length;
}

// Maps a subcommand word to its GitOperationKind, defaulting to `other`.
function parseGitOperationKind(subcommand: string | undefined): GitOperationKind {
  for (const kind of KNOWN_GIT_OPERATION_KINDS) {
    if (kind === subcommand)
      return kind;
  }
  return GitOperationKind.other;
}

// `token` without its surrounding quote pair, when it has one ("baseline" -> baseline).
// ponytail: escaped quotes inside the token are left as-is — no fixture exercises them.
function trimSurroundingQuotes(token: string): string {
  if (token.length < 2)
    return token;
  const first = token[0]!;
  const last = token[token.length - 1]!;
  if (first !== last)
    return token;
  if (first === '"')
    return token.slice(1, -1);
  if (first === "'")
    return token.slice(1, -1);
  return token;
}

// The first argument that is not a flag, or "" — a branch/checkout command's branch name.
function findFirstNonFlagArgument(argumentTokens: string[]): string {
  for (const token of argumentTokens) {
    const isFlag = token.startsWith("-");
    if (!isFlag)
      return token;
  }
  return "";
}

// Every argument that is not a flag, joined by spaces.
function joinNonFlagArguments(argumentTokens: string[]): string {
  const paths: string[] = [];
  for (const token of argumentTokens) {
    const isFlag = token.startsWith("-");
    if (!isFlag)
      paths.push(token);
  }
  return paths.join(" ");
}

// Extracts the human-readable detail string for a git operation's kind.
function parseGitOperationDetail(kind: GitOperationKind, tokens: string[], subcommandIndex: number): string {
  const argumentTokens = tokens.slice(subcommandIndex + 1);
  if (kind === GitOperationKind.commit) {
    const messageFlagIndex = argumentTokens.indexOf("-m");
    if (messageFlagIndex < 0)
      return "";
    const message = argumentTokens[messageFlagIndex + 1];
    if (message === undefined)
      return "";
    return trimSurroundingQuotes(message);
  }
  if (kind === GitOperationKind.add) {
    return joinNonFlagArguments(argumentTokens);
  }
  if (kind === GitOperationKind.branch) {
    return findFirstNonFlagArgument(argumentTokens);
  }
  if (kind === GitOperationKind.checkout) {
    return findFirstNonFlagArgument(argumentTokens);
  }
  return "";
}

// The kind and detail of one git command string, from its tokenized words.
export function parseGitCommandWords(command: string): { kind: GitOperationKind; detail: string } {
  const matchedTokens = command.match(shellCommandToken);
  let tokens: string[] = [];
  if (matchedTokens !== null)
    tokens = matchedTokens;
  const subcommandIndex = findSubcommandIndex(tokens);
  const kind = parseGitOperationKind(tokens[subcommandIndex]);
  return { kind, detail: parseGitOperationDetail(kind, tokens, subcommandIndex) };
}
