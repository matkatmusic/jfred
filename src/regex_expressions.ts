// Every engine regular expression, named once. Use `g` constants only with `.match()` or `.replace()`.
import {
  anyChar, capturedWord, digit, endAnchor, globalFlag, lazy, literalDot, literalPipe, lowercaseLetter,
  matchAnyOf, matchNoneOf, matchOneOf, matchRepeatBetween, oneOrMore, oneOrMoreWhitespace, startAnchor, tab,
  whitespace, wordChar, wrapCapture, wrapLookahead, wrapNegativeLookahead, wrapNegativeLookbehind,
  wrapOptionalGroup, zeroOrMore, zeroOrMoreWhitespace,
} from "./regex_tokens.ts";

// A bare line number such as "12": digits only. Same as /^\d+$/.
export const numbersOnly = new RegExp(startAnchor + digit + oneOrMore + endAnchor);

// A run of whitespace, used to split a command tail into words. Same as /\s+/.
export const whitespaceRun = new RegExp(oneOrMoreWhitespace);

// `rm <paths>`: group 1 is the rest of the line. Same as /^rm\s+(.+)$/.
export const bashRemoveCommand = new RegExp(
  startAnchor + "rm" + oneOrMoreWhitespace + wrapCapture(anyChar + oneOrMore) + endAnchor,
);

// `mv <src> <dst>` or `git mv <src> <dst>`: group 1 is the source, group 2 the destination.
export const bashMoveCommand = new RegExp(
  startAnchor + wrapOptionalGroup("git" + oneOrMoreWhitespace) + "mv" + oneOrMoreWhitespace +
        capturedWord + oneOrMoreWhitespace + capturedWord + endAnchor,
);

// `cp <src> <dst>`: group 1 is the source, group 2 the destination. Same as /^cp\s+(\S+)\s+(\S+)$/.
export const bashCopyCommand = new RegExp(
  startAnchor + "cp" + oneOrMoreWhitespace + capturedWord + oneOrMoreWhitespace + capturedWord + endAnchor,
);

// A `>> <file>` append redirect at the end of a command: group 1 is the filename.
export const bashAppendRedirect = new RegExp(
  ">>" + zeroOrMoreWhitespace + capturedWord + zeroOrMoreWhitespace + endAnchor,
);

// An overwrite redirect `> <file>` ending a command; skips `>>` and `>&2`. Group 1 is the filename.
export const bashOverwriteRedirect = new RegExp(
  wrapNegativeLookbehind(">") + ">" + zeroOrMoreWhitespace + wrapNegativeLookahead("&") +
        capturedWord + zeroOrMoreWhitespace + endAnchor,
);

// The `toolu_` prefix at the start of an id. Same as /^toolu_/.
export const toolUseIdPrefix = new RegExp(startAnchor + "toolu_");

// One whitespace character; split on it to keep the first word. Same as /\s/.
export const singleWhitespace = new RegExp(whitespace);

// Every double-quoted filename such as `"billing.py"`; group 1 is the text inside the quotes.
export const quotedFilename = new RegExp(
  '"' + wrapCapture(matchNoneOf('"') + oneOrMore + literalDot + lowercaseLetter + matchRepeatBetween(1, 4)) + '"',
  globalFlag,
);

// Every run of whitespace, so a replace collapses the whole string. Same as /\s+/g.
export const whitespaceRuns = new RegExp(oneOrMoreWhitespace, globalFlag);

// A leading line-number prefix such as "3\t". Same as /^\d+\t/.
export const lineNumberPrefix = new RegExp(startAnchor + digit + oneOrMore + tab);

// A numbered snippet line "12\tdef hello()": group 1 is the number, group 2 the text.
export const numberedLine = new RegExp(
  startAnchor + wrapCapture(digit + oneOrMore) + tab + wrapCapture(anyChar + zeroOrMore) + endAnchor,
);

// A markdown ledger row; group 1 is the id, group 2 the last cell.
export const ledgerRow = new RegExp(
  startAnchor + literalPipe + zeroOrMoreWhitespace + wrapCapture("s" + digit + oneOrMore) + zeroOrMoreWhitespace +
        literalPipe + matchNoneOf("|") + zeroOrMore + literalPipe + matchNoneOf("|") + zeroOrMore + literalPipe +
        zeroOrMoreWhitespace + wrapCapture(anyChar + oneOrMore + lazy) + zeroOrMoreWhitespace + literalPipe + endAnchor,
);

// Every "branch rewound" in a render. Same as /branch rewound/g.
export const branchRewoundHeader = new RegExp("branch rewound", globalFlag);

// Every "rewound" in a render. Same as /rewound/g.
export const rewoundMention = new RegExp("rewound", globalFlag);

// A zero-width cut point before each "@@ " diff hunk header. Same as /(?=@@ )/.
export const beforeDiffHunkHeader = new RegExp(wrapLookahead("@@ "));

// A `git commit` command, optionally with `git -C <dir>`: group 1 is the directory when present.
export const gitCommitCommand = new RegExp(
  startAnchor + "git" + wrapOptionalGroup(oneOrMoreWhitespace + "-C" + oneOrMoreWhitespace + capturedWord) +
        oneOrMoreWhitespace + "commit" + wrapNegativeLookahead(wordChar),
);

// The `[master (root-commit) ab12cd3] init` summary line of a commit: group 1 is the 7-to-40-char hash.
export const gitCommitResultHashLine = new RegExp(
  "\\[" + matchNoneOf("\\[\\]\\n") + oneOrMore + lazy + " " + wrapOptionalGroup("\\(root-commit\\) ") +
        wrapCapture(matchOneOf("0-9a-f") + matchRepeatBetween(7, 40)) + "\\]",
);

// A whole-word hex hash of 7 to 40 chars; group 1 is the hash.
export const bareCommitHashToken = new RegExp(
  wrapNegativeLookbehind(wordChar) + wrapCapture(matchOneOf("0-9a-f") + matchRepeatBetween(7, 40)) + wrapNegativeLookahead(wordChar),
);

// A command that starts with the word `git` and a space. Same as /^git\s/.
export const gitCommandStart = new RegExp(startAnchor + "git" + whitespace);

// Every shell word of a command line; a quoted argument stays one token. The caller strips the quotes.
export const shellCommandToken = new RegExp(
  matchAnyOf(
    matchNoneOf(whitespace + '"' + "'") + oneOrMore,
    '"' + matchNoneOf('"') + zeroOrMore + '"',
    "'" + matchNoneOf("'") + zeroOrMore + "'",
  ) + oneOrMore,
  globalFlag,
);

// A filename with a dot-extension such as "core_one.py"; braces are excluded, so `{name}.py` is no token.
const filenameToken = matchOneOf(wordChar + "./-") + oneOrMore + literalDot + wordChar + oneOrMore;

// A printed `<old> -> <new>` rename where both sides are filenames: group 1 is old, group 2 new.
export const renameArrowLine = new RegExp(
  wrapCapture(filenameToken) + zeroOrMoreWhitespace + "->" + zeroOrMoreWhitespace + wrapCapture(filenameToken),
  globalFlag,
);

// A `git add` command, optionally with `git -C <dir>`: group 1 is the directory, group 2 the argument tail.
export const gitAddCommand = new RegExp(
  startAnchor + "git" + wrapOptionalGroup(oneOrMoreWhitespace + "-C" + oneOrMoreWhitespace + capturedWord) +
        oneOrMoreWhitespace + "add" + wrapNegativeLookahead(wordChar) + wrapCapture(".*"),
);

// A `shutil.move("a", "b")` or `os.rename("a", "b")` call with literal strings: group 1 source, group 2 destination.
export const codeLiteralMoveCall = new RegExp(
  matchAnyOf("shutil" + literalDot + "move", "os" + literalDot + "rename")
    + "\\(" + zeroOrMoreWhitespace
    + '"' + wrapCapture(matchNoneOf('"') + oneOrMore) + '"'
    + zeroOrMoreWhitespace + "," + zeroOrMoreWhitespace
    + '"' + wrapCapture(matchNoneOf('"') + oneOrMore) + '"'
    + zeroOrMoreWhitespace + "\\)",
  globalFlag,
);
