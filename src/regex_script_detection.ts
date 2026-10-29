// --- static read-only script detection (TASKS.md item 68) ------------------------------------------- The regular expressions that classify a script's source as read-only vs may-write before it runs under the sandbox. Split from regex_expressions.ts, which keeps the shared token vocabulary and every other engine pattern; the same `g`-flag safety note there applies to these constants.

import { globalFlag, zeroOrMoreWhitespace } from "./regex_tokens.ts";

// The `m` flag: `^` and `$` anchor at every line, to walk import statements line by line.
const multilineFlag = "m";

// Every `open(` call in a script, including method and longer-name forms. Use only with `.matchAll()`.
export const openCallToken = new RegExp("open" + zeroOrMoreWhitespace + "\\(", globalFlag);

// An open() argument that keeps the call a read: r, rb or rt mode, or a non-mode keyword.
export const readOnlyOpenArgument = new RegExp(
  "^\\s*(?:[\"']r[bt]?[\"']|mode\\s*=\\s*[\"']r[bt]?[\"']|(?:encoding|errors|newline|buffering|closefd|opener)\\s*=)",
);

// A python construct that can write files or escape analysis: a write method call, `exec(`, `eval(` or `__import__`.
export const pythonWritePrimitive = new RegExp(
  "\\.(?:write_text|write_bytes|touch|mkdir|makedirs|rename|replace|remove|unlink|rmdir|symlink_to|hardlink_to|truncate|system|popen)\\s*\\(" +
        "|\\b(?:exec|eval)\\s*\\(|__import__|writeFileSync|appendFileSync",
);

// A shell construct that writes files: a write-verb word, `sed -i`, or a redirect to a file path.
// ponytail: raw-text scan, same ceiling as pythonWritePrimitive — these tokens inside python strings, and float comparisons (`x > 0.5`), read as may-write. Accepted false may-writes (item-68 rule: narrow read-only, never widen); each costs only a wasted sandbox attempt.
export const shellWritePrimitive = new RegExp(
  "\\b(?:mv|cp|rm|mkdir|touch|tee)\\b|(?<![\\w-])ln\\b|\\bsed[ \\t]+-i\\b" +
        "|>{1,2}[ \\t]*(?!/dev/null\\b)[\\w~-]*[./][\\w./~-]*",
);

// A whole `import …` line: group 1 is everything after `import`. Use only with `.matchAll()`.
export const importStatementLine = new RegExp(
  "^[ \\t]*import[ \\t]+(.+)$",
  globalFlag + multilineFlag,
);

// A whole `from <module> import <names>` line: group 1 is the module path, group 2 the names.
export const fromImportStatementLine = new RegExp(
  "^[ \\t]*from[ \\t]+([\\w.]+)[ \\t]+import[ \\t]+(.+)$",
  globalFlag + multilineFlag,
);

// A whole-word imported name that can write, such as `remove` in `from os import remove`.
export const writingImportedName = new RegExp(
  "\\b(?:open|rename|replace|remove|unlink|rmdir|mkdir|makedirs|symlink|link|system|popen|truncate|fdopen)\\b",
);
