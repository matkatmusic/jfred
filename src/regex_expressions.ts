// Every regular expression used across the reconstruction engine and its tests, named once here so call
// sites read as `text.match(bashCopyCommand)` rather than carrying an opaque pattern inline. Each comment
// describes, in plain English, what the pattern matches and gives a worked example. The one canonical home
// for these patterns — callers import the named constant directly (no inline regex literals elsewhere).
//
// `g`-flag note: the global constants below are only ever used with `.match()` / `.replace()`, which reset
// `lastIndex` on every call, so sharing a single module-level object is safe. Do NOT use a `g` constant with
// `.test()` / `.exec()` in a loop — that advances `lastIndex` and the shared state would leak between callers.

// --- regex token vocabulary (template) --------------------------------------------------------------
// Named building blocks for composing a pattern from words instead of punctuation, for readers who don't
// read raw regex. Each is a fragment of regex SOURCE as a string; note the `\`-tokens need a doubled
// backslash because e.g. `"\d"` in a JS string silently collapses to `"d"`. Only the simplest constants use
// these — the hairy ones below stay as literals (a long chain of named tokens is harder to follow, not easier).
const startAnchor = "^";      // matches the start position (matches nothing, just asserts "we're at the start")
const digit = "\\d";          // one digit, 0-9 (source is `\d`; the string needs `\\d`)
const wordChar = "\\w";       // one word char: letter, digit, or underscore (source is `\w`; string needs `\\w`)
const whitespace = "\\s";     // one whitespace char — space, tab, newline (source is `\s`; string needs `\\s`)
const nonWhitespace = "\\S";  // one NON-whitespace char (source is `\S`; the string needs `\\S`)
const anyChar = ".";          // any single character
const literalDot = "\\.";     // a literal `.` character (source is `\.`; unlike anyChar, matches ONLY a dot)
const lowercaseLetter = "[a-z]"; // one lowercase letter, a–z
const literalPipe = "\\|";    // a literal `|` character (source is `\|`; unescaped `|` would mean "or")
const oneOrMore = "+";        // one or more of the token immediately before it (so `\d+` = one or more digits)
const zeroOrMore = "*";       // zero or more of the token immediately before it (so `\s*` = optional spaces)
const lazy = "?";             // makes the PRECEDING quantifier non-greedy — match as FEW as possible
const tab = "\\t";            // a single TAB character (source is `\t`; the string needs `\\t`)
const endAnchor = "$";        // matches the end position

// A FLAG, not a source fragment: it is passed as the SECOND argument to `new RegExp(source, flags)`, never
// concatenated into the pattern. `g` = act on EVERY match (find-all / replace-all), not just the first.
export const globalFlag = "g";

// --- composed fragments + group helpers -------------------------------------------------------------
// Reusable SOURCE STRINGS built from the tokens above (never RegExp objects — stringifying a RegExp would
// re-insert the `/…/` delimiters). Concatenate these, then wrap the whole thing in one `new RegExp(...)`.
const oneOrMoreWhitespace = whitespace + oneOrMore;   // `\s+` — a run of spaces separating command words
export const zeroOrMoreWhitespace = whitespace + zeroOrMore; // `\s*` — optional spaces (may be none)
// Wrap a fragment in a capturing group `( … )` so `.match()` returns it as a numbered group.
const capture = (inner: string): string => "(" + inner + ")";
// Wrap a fragment in an OPTIONAL non-capturing group `(?: … )?` — it may appear once or not at all.
const optionalGroup = (inner: string): string => "(?:" + inner + ")?";
const capturedWord = capture(nonWhitespace + oneOrMore); // `(\S+)` — a captured run of non-space chars (a path)

// Zero-width assertions: they check what's next to the current position WITHOUT consuming any characters.
const lookahead = (inner: string): string => "(?=" + inner + ")";           // inner MUST follow
const negativeLookahead = (inner: string): string => "(?!" + inner + ")";   // inner must NOT follow
const negativeLookbehind = (inner: string): string => "(?<!" + inner + ")"; // inner must NOT precede
// One of several alternative fragments `(?:a|b|c)` — whichever alternative matches first wins.
const anyOf = (...alternatives: string[]): string => "(?:" + alternatives.join("|") + ")";
// A negated character class `[^…]`: any single character that is NOT one of the listed ones.
const noneOf = (chars: string): string => "[^" + chars + "]";
// A positive character class `[…]`: any single character that IS one of the listed ones.
const oneOf = (chars: string): string => "[" + chars + "]";
// A range quantifier `{min,max}`: the preceding token repeats between min and max times (e.g. `[a-z]{1,4}`).
const repeatBetween = (min: number, max: number): string => "{" + min + "," + max + "}";

// ALL digits from start to end, i.e. a bare line number like "12". Composed from the tokens above; it is
// exactly equivalent to the literal /^\d+$/.
export const numbersOnly = new RegExp(startAnchor + digit + oneOrMore + endAnchor);

// A run of one or more whitespace characters, used to split a command tail into separate words. Equivalent
// to the literal /\s+/.
export const whitespaceRun = new RegExp(oneOrMoreWhitespace);

// `rm <paths>`: `rm`, then spaces, then group 1 = the rest of the line (one or more paths, split later).
// e.g. "rm a.py b.py" -> group 1 = "a.py b.py". Equivalent to the literal /^rm\s+(.+)$/.
export const bashRemoveCommand = new RegExp(
    startAnchor + "rm" + oneOrMoreWhitespace + capture(anyChar + oneOrMore) + endAnchor,
);

// `mv <src> <dst>` or `git mv <src> <dst>`: optional `git ` prefix, then `mv`, then two space-separated
// non-space words. group 1 = source, group 2 = destination. e.g. "git mv old.py new.py" -> "old.py","new.py".
// Equivalent to the literal /^(?:git\s+)?mv\s+(\S+)\s+(\S+)$/.
export const bashMoveCommand = new RegExp(
    startAnchor + optionalGroup("git" + oneOrMoreWhitespace) + "mv" + oneOrMoreWhitespace +
        capturedWord + oneOrMoreWhitespace + capturedWord + endAnchor,
);

// `cp <src> <dst>`: `cp`, then two space-separated non-space words. group 1 = source, group 2 = destination.
// e.g. "cp a.py b.py" -> "a.py","b.py". Equivalent to the literal /^cp\s+(\S+)\s+(\S+)$/.
export const bashCopyCommand = new RegExp(
    startAnchor + "cp" + oneOrMoreWhitespace + capturedWord + oneOrMoreWhitespace + capturedWord + endAnchor,
);

// A `>> <file>` append redirect at the END of a command: `>>`, optional spaces, group 1 = the filename,
// optional trailing spaces. e.g. "echo hi >> log.txt" -> group 1 = "log.txt". Equivalent to />>\s*(\S+)\s*$/.
export const bashAppendRedirect = new RegExp(
    ">>" + zeroOrMoreWhitespace + capturedWord + zeroOrMoreWhitespace + endAnchor,
);

// A single `> <file>` overwrite redirect at the END of a command. group 1 = the filename. Two guards reject
// look-alikes: `(?<!>)` skips `>>` (append), `(?!&)` skips `>&2` (a file-descriptor dup, not a file).
// e.g. "echo hi > out.txt" -> group 1 = "out.txt". Equivalent to the literal /(?<!>)>\s*(?!&)(\S+)\s*$/.
export const bashOverwriteRedirect = new RegExp(
    negativeLookbehind(">") + ">" + zeroOrMoreWhitespace + negativeLookahead("&") +
        capturedWord + zeroOrMoreWhitespace + endAnchor,
);

// The literal `toolu_` only when it sits at the very start of an id; replacing it with "" drops that leading
// prefix. e.g. "toolu_01ABCD..." -> "01ABCD...". Equivalent to the literal /^toolu_/.
export const toolUseIdPrefix = new RegExp(startAnchor + "toolu_");

// A single whitespace character; splitting on it and taking [0] keeps the first word of a string. Equivalent
// to the literal /\s/.
export const singleWhitespace = new RegExp(whitespace);

// Every double-quoted string that looks like a filename: an opening `"`, one-or-more non-quote chars, a
// literal dot, a 1-to-4-letter extension, a closing `"`. The `g` flag finds ALL of them, not just the first.
// e.g. matches `"billing.py"` and `"renames.csv"`. (Quotes are sliced off by the caller.) Equivalent to the
// literal /"([^"]+\.[a-z]{1,4})"/g.
export const quotedFilename = new RegExp(
    '"' + capture(noneOf('"') + oneOrMore + literalDot + lowercaseLetter + repeatBetween(1, 4)) + '"',
    globalFlag,
);

// Every run of whitespace (spaces, tabs, newlines); the `g` flag makes a replace hit all runs, not just the
// first, so collapsing to a single space flattens the whole string. Equivalent to the literal /\s+/g.
export const whitespaceRuns = new RegExp(oneOrMoreWhitespace, globalFlag);

// A leading line-number prefix: one-or-more digits at the start of the line followed by a TAB. Replacing it
// with "" strips the "3\t" off "3\tdef hello()". Equivalent to the literal /^\d+\t/.
export const lineNumberPrefix = new RegExp(startAnchor + digit + oneOrMore + tab);

// A numbered snippet line: group 1 = the leading digits (the line number), then a TAB, then group 2 = the
// rest of the line (the text). e.g. "12\tdef hello()" -> "12","def hello()". A bare `...` line has no
// number+tab, so it won't match.
export const numberedLine = new RegExp(
    startAnchor + capture(digit + oneOrMore) + tab + capture(anyChar + zeroOrMore) + endAnchor,
);

// One markdown ledger row shaped like `| s19 | PASS | 4/4 | 2026-06-25T20:41:00.000Z |`. Left to right:
// leading `|`, scenario id (group 1 = "s" + digits), `|`, status cell (ignored), `|`, count cell (ignored),
// `|`, last cell (group 2 = the timestamp or the word "never"), trailing `|`. Each `\s*` is cell padding.
// group 2 is LAZY (`.+?`) so it stops at the first trailing `|` instead of swallowing it. Equivalent to the
// literal /^\|\s*(s\d+)\s*\|[^|]*\|[^|]*\|\s*(.+?)\s*\|$/.
export const ledgerRow = new RegExp(
    startAnchor + literalPipe + zeroOrMoreWhitespace + capture("s" + digit + oneOrMore) + zeroOrMoreWhitespace +
        literalPipe + noneOf("|") + zeroOrMore + literalPipe + noneOf("|") + zeroOrMore + literalPipe +
        zeroOrMoreWhitespace + capture(anyChar + oneOrMore + lazy) + zeroOrMoreWhitespace + literalPipe + endAnchor,
);

// The literal text "branch rewound"; the `g` flag makes `.match` return EVERY occurrence, so `.length`
// counts how many branch-rewound wrappers a render contains. Equivalent to the literal /branch rewound/g.
export const branchRewoundHeader = new RegExp("branch rewound", globalFlag);

// The literal word "rewound"; `g` so `.match(...).length` counts every mention in a render. Equivalent to
// the literal /rewound/g.
export const rewoundMention = new RegExp("rewound", globalFlag);

// A "cut here but keep the marker" boundary: splits a diff right BEFORE every "@@ " hunk header without
// deleting it, so each resulting block still begins with its own "@@ …" header line. Equivalent to /(?=@@ )/.
export const beforeDiffHunkHeader = new RegExp(lookahead("@@ "));

// A recorded `git commit` command, with or without a `git -C <dir>` repo override. group 1 = the -C
// directory when present. The trailing negative lookahead rejects a word continuing past "commit"
// (e.g. a hypothetical "git commitx"). e.g. `git -C /tmp/repo commit -m "baseline"` -> group 1 =
// "/tmp/repo"; `git commit -m "x"` -> group 1 = undefined. Equivalent to the literal
// /^git(?:\s+-C\s+(\S+))?\s+commit(?!\w)/.
export const gitCommitCommand = new RegExp(
    startAnchor + "git" + optionalGroup(oneOrMoreWhitespace + "-C" + oneOrMoreWhitespace + capturedWord) +
        oneOrMoreWhitespace + "commit" + negativeLookahead(wordChar),
);

// git commit's summary line in the command's printed output: an open bracket, the branch name (any
// run of chars with no bracket/newline, lazily), a space, an optional `(root-commit) ` marker, then
// group 1 = the 7-to-40-char lowercase-hex commit hash, then the closing bracket. e.g.
// `[master 4fa08d2] fix: x` -> group 1 = "4fa08d2"; `[master (root-commit) ab12cd3] init` -> group
// 1 = "ab12cd3". Equivalent to the literal /\[[^\[\]\n]+? (?:\(root-commit\) )?([0-9a-f]{7,40})\]/.
export const gitCommitResultHashLine = new RegExp(
    "\\[" + noneOf("\\[\\]\\n") + oneOrMore + lazy + " " + optionalGroup("\\(root-commit\\) ") +
        capture(oneOf("0-9a-f") + repeatBetween(7, 40)) + "\\]",
);

// Fallback for commit results whose `[branch hash]` summary was piped away and replaced by a
// custom line that still contains the hash (s84/s85 scenario captures print `ok 928eaa9`): a
// WHOLE-WORD run of 7-to-40 lowercase-hex chars — the boundaries reject hex-looking substrings
// of longer words. group 1 = the hash. Equivalent to the literal /(?<!\w)([0-9a-f]{7,40})(?!\w)/.
export const bareCommitHashToken = new RegExp(
    negativeLookbehind(wordChar) + capture(oneOf("0-9a-f") + repeatBetween(7, 40)) + negativeLookahead(wordChar),
);

// A command that IS a git invocation: the word `git` at the very start, followed by whitespace.
// e.g. matches "git init" and "git -C /tmp/repo add a.py"; does NOT match "github-cli sync" (no
// space after "git") or "echo git" (not at the start). Equivalent to the literal /^git\s/.
export const gitCommandStart = new RegExp(startAnchor + "git" + whitespace);

// One shell word of a command line: runs of plain (non-space, non-quote) chars and/or quoted
// segments ("…" or '…'), glued together. The `g` flag finds EVERY word, and a quoted argument
// stays ONE token even when it contains spaces. e.g. `git commit -m "post rename"` ->
// ["git", "commit", "-m", "\"post rename\""] (the caller strips the quotes). Equivalent to the
// literal /(?:[^\s"']+|"[^"]*"|'[^']*')+/g.
export const shellCommandToken = new RegExp(
    anyOf(
        noneOf(whitespace + '"' + "'") + oneOrMore,
        '"' + noneOf('"') + zeroOrMore + '"',
        "'" + noneOf("'") + zeroOrMore + "'",
    ) + oneOrMore,
    globalFlag,
);

// A filename token: one or more path chars ("[\w./-]") ending in a dot-extension, e.g. "core_one.py" or
// "tests/a.py". The class excludes `{ } " ( )`, so an echoed f-string like `{name}.py` is NOT a token.
const filenameToken = oneOf(wordChar + "./-") + oneOrMore + literalDot + wordChar + oneOrMore; // [\w./-]+\.\w+

// A printed rename line `<old> -> <new>` where BOTH sides are filename tokens (each ends in a dot-extension).
// group 1 = old path, group 2 = new path. `g` finds every rename a run prints. The dot-extension requirement
// is the guard: a script's real stdout `one.py -> core_one.py` matches, but a function-rename `f_one -> alpha`
// (no extension) and the echoed f-string code `{name}.py -> core_{name}.py` (braces aren't path chars) do NOT.
// Equivalent to the literal /([\w./-]+\.\w+)\s*->\s*([\w./-]+\.\w+)/g.
export const renameArrowLine = new RegExp(
    capture(filenameToken) + zeroOrMoreWhitespace + "->" + zeroOrMoreWhitespace + capture(filenameToken),
    globalFlag,
);

// A recorded `git add` command, with or without a `git -C <dir>` repo override. group 1 = the -C
// directory when present; group 2 = everything after "add" (the argument tail, parsed by the
// caller into explicit paths). Same shape as gitCommitCommand. Equivalent to the literal
// /^git(?:\s+-C\s+(\S+))?\s+add(?!\w)(.*)/.
export const gitAddCommand = new RegExp(
    startAnchor + "git" + optionalGroup(oneOrMoreWhitespace + "-C" + oneOrMoreWhitespace + capturedWord) +
        oneOrMoreWhitespace + "add" + negativeLookahead(wordChar) + capture(".*"),
);

// A two-string-literal move call in script CODE: `shutil.move("a.py", "b.py")` or
// `os.rename("a.py", "b.py")`. group 1 = source, group 2 = destination. `g` finds every such call
// in a run's code. Only LITERAL string arguments match — the variable form `shutil.move(src, dst)`
// has no quotes, so a loop over computed pairs never fabricates a rename (s87 step 89's code names
// its destinations literally; its loop body does not).
// Equivalent to the literal /(?:shutil\.move|os\.rename)\(\s*"([^"]+)"\s*,\s*"([^"]+)"\s*\)/g.
export const codeLiteralMoveCall = new RegExp(
    anyOf("shutil" + literalDot + "move", "os" + literalDot + "rename")
    + "\\(" + zeroOrMoreWhitespace
    + '"' + capture(noneOf('"') + oneOrMore) + '"'
    + zeroOrMoreWhitespace + "," + zeroOrMoreWhitespace
    + '"' + capture(noneOf('"') + oneOrMore) + '"'
    + zeroOrMoreWhitespace + "\\)",
    globalFlag,
);

