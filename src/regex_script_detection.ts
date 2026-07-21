// --- static read-only script detection (TASKS.md item 68) -------------------------------------------
// The regular expressions that classify a script's source as read-only vs may-write before it runs
// under the sandbox. Split from regex_expressions.ts, which keeps the shared token vocabulary and
// every other engine pattern; the same `g`-flag safety note there applies to these constants.

import { globalFlag, zeroOrMoreWhitespace } from "./regex_expressions.ts";

// The `m` flag: `^`/`$` anchor at every LINE start/end instead of only the string ends — needed to walk
// a script's import statements line by line.
const multilineFlag = "m";

// Every `open(` call in a script, with optional space before the paren; `g` finds ALL of them. It also
// matches method forms (`p.open(`, `io.open(`) — the caller inspects the char before the match to tell a
// dot-call from the builtin — and hits inside longer names (`reopen(`), which only ever bails the
// analysis toward may-write. Used ONLY with `.matchAll()` (never `.test()`/`.exec()`, per the g-flag
// note above). Equivalent to the literal /open\s*\(/g.
export const openCallToken = new RegExp("open" + zeroOrMoreWhitespace + "\\(", globalFlag);

// An open() argument that keeps the call a READ: a literal "r"/"rb"/"rt" mode (either quote style), an
// explicit mode="r…", or a keyword argument that is not `mode` (mode then defaults to "r"). "r+"
// deliberately does NOT match — it opens the file for writing too. e.g. matches ` "rb"` and
// ` encoding="utf-8"`; rejects ` "w"`, ` mode` (a variable), ` "r+"`. Equivalent to the literal
// /^\s*(?:["']r[bt]?["']|mode\s*=\s*["']r[bt]?["']|(?:encoding|errors|newline|buffering|closefd|opener)\s*=)/.
export const readOnlyOpenArgument = new RegExp(
    "^\\s*(?:[\"']r[bt]?[\"']|mode\\s*=\\s*[\"']r[bt]?[\"']|(?:encoding|errors|newline|buffering|closefd|opener)\\s*=)",
);

// A python construct that can write, delete, rename, or create files (or escape static analysis) when a
// script runs under the python3 sandbox: a write/rename/delete METHOD call (the leading `.` covers both
// `os.rename(...)` and `Path(...).rename(...)`), a dynamic-execution escape (`exec(`/`eval(`/
// `__import__`), or a JS write call (free to include, though a JS script crashes under python3 anyway).
// `.replace(`/`.remove(` also hit read-only `str.replace`/`list.remove` — accepted false may-writes:
// they only cost a sandbox run, never evidence. No `g` flag — used with `.test()`. Equivalent to the
// literal /\.(?:write_text|write_bytes|touch|mkdir|makedirs|rename|replace|remove|unlink|rmdir|symlink_to|hardlink_to|truncate|system|popen)\s*\(|\b(?:exec|eval)\s*\(|__import__|writeFileSync|appendFileSync/.
export const pythonWritePrimitive = new RegExp(
    "\\.(?:write_text|write_bytes|touch|mkdir|makedirs|rename|replace|remove|unlink|rmdir|symlink_to|hardlink_to|truncate|system|popen)\\s*\\(" +
        "|\\b(?:exec|eval)\\s*\\(|__import__|writeFileSync|appendFileSync",
);

// A shell construct that moves, copies, deletes, or creates files when the run is a plain bash
// command line (task 139; the s2 `mv` was labeled read-only by the python-only checks above): a
// write-verb word, `sed -i`, or an output redirect whose target looks like a file path (contains
// "." or "/"). `2>&1` never matches (its target has no "."/"/") and `/dev/null` is excluded
// explicitly. No `g` flag — used with `.test()`. Equivalent to the literal
// /\b(?:mv|cp|rm|mkdir|touch|tee|ln)\b|\bsed[ \t]+-i\b|>{1,2}[ \t]*(?!\/dev\/null\b)[\w~-]*[./][\w./~-]*/.
// ponytail: raw-text scan, same ceiling as pythonWritePrimitive — these tokens inside python
// strings, and float comparisons (`x > 0.5`), read as may-write. Accepted false may-writes
// (item-68 rule: narrow read-only, never widen); each costs only a wasted sandbox attempt.
export const shellWritePrimitive = new RegExp(
    "\\b(?:mv|cp|rm|mkdir|touch|tee|ln)\\b|\\bsed[ \\t]+-i\\b" +
        "|>{1,2}[ \\t]*(?!/dev/null\\b)[\\w~-]*[./][\\w./~-]*",
);

// A whole `import …` line: group 1 = everything after `import` (a comma list, an `as` alias, or junk
// like "os; print(1)" — junk fails the caller's allowlist and lands on may-write, the safe side).
// `[ \t]` instead of `\s` so the match never crosses the line break. e.g. "import os, re" -> group 1 =
// "os, re". Used ONLY with `.matchAll()`. Equivalent to the literal /^[ \t]*import[ \t]+(.+)$/gm.
export const importStatementLine = new RegExp(
    "^[ \\t]*import[ \\t]+(.+)$",
    globalFlag + multilineFlag,
);

// A whole `from <module> import <names>` line: group 1 = the dotted module path, group 2 = the imported
// names. e.g. "from os.path import join" -> "os.path", "join". Used ONLY with `.matchAll()`. Equivalent
// to the literal /^[ \t]*from[ \t]+([\w.]+)[ \t]+import[ \t]+(.+)$/gm.
export const fromImportStatementLine = new RegExp(
    "^[ \\t]*from[ \\t]+([\\w.]+)[ \\t]+import[ \\t]+(.+)$",
    globalFlag + multilineFlag,
);

// A from-imported name that can write even when its root module is allowlisted (`from os import
// remove`, `from io import open`). Whole-word, so `islink` and `Optional` do NOT match. No `g` flag —
// used with `.test()`. Equivalent to the literal
// /\b(?:open|rename|replace|remove|unlink|rmdir|mkdir|makedirs|symlink|link|system|popen|truncate|fdopen)\b/.
export const writingImportedName = new RegExp(
    "\\b(?:open|rename|replace|remove|unlink|rmdir|mkdir|makedirs|symlink|link|system|popen|truncate|fdopen)\\b",
);
