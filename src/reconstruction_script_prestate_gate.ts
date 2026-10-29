// Import and open() checks behind the static read-only gate in reconstruction_script_prestate.ts.

import { singleWhitespace } from "./regex_expressions.ts";
import {
  fromImportStatementLine,
  importStatementLine,
  openCallToken,
  readOnlyOpenArgument,
  writingImportedName,
} from "./regex_script_detection.ts";

// Stdlib roots a read-only script may import; any other import marks it may-write.
const READ_ONLY_SAFE_IMPORT_ROOTS = new Set([
  "os", "sys", "re", "json", "csv", "glob", "pathlib", "collections", "itertools",
  "functools", "math", "statistics", "textwrap", "difflib", "datetime", "time", "string",
  "typing", "dataclasses", "enum", "pprint", "fnmatch", "bisect", "heapq", "operator",
  "hashlib", "unicodedata", "copy", "ast", "tokenize", "keyword", "inspect", "traceback",
  "argparse", "random", "io", "base64", "struct", "uuid",
]);

// Whether every import in `code` names only safe stdlib roots, with no from-import smuggling a writing name out.
export function isEveryImportReadOnlySafe(code: string): boolean {
  for (const match of code.matchAll(importStatementLine)) {
    for (const item of match[1]!.split(",")) {
      const root = item.trim().split(singleWhitespace)[0]?.split(".")[0] ?? "";
      const isSafeRoot = READ_ONLY_SAFE_IMPORT_ROOTS.has(root);
      if (!isSafeRoot)
        return false;
    }
  }
  for (const match of code.matchAll(fromImportStatementLine)) {
    const root = match[1]!.split(".")[0] ?? "";
    const isSafeRoot = READ_ONLY_SAFE_IMPORT_ROOTS.has(root);
    if (!isSafeRoot)
      return false;
    const importsWritingName = writingImportedName.test(match[2]!);
    if (importsWritingName)
      return false;
  }
  return true;
}

// Whether every open( call in `code` is provably read-mode; anything the cheap first-")" parse can't prove counts as may-write.
export function isEveryOpenCallRead(code: string): boolean {
  for (const match of code.matchAll(openCallToken)) {
    const argsStart = match.index! + match[0].length;
    const argsEnd = code.indexOf(")", argsStart);
    if (argsEnd < 0)
      return false;
    const args = code.slice(argsStart, argsEnd);
    // A nested call could hide a write mode, so treat the script as may-write.
    const hasNestedCall = args.includes("(");
    if (hasNestedCall)
      return false;
    const parts = args.split(",");
    const isDotCall = match.index! > 0 && code[match.index! - 1] === ".";
    if (isDotCall) {
      // Path.open(): no arguments defaults to mode "r".
      const hasNoArguments = args.trim() === "";
      if (hasNoArguments)
        continue;
      const isReadModeArgument = readOnlyOpenArgument.test(parts[0]!);
      if (!isReadModeArgument)
        return false;
      continue;
    }
    // builtin open(file): a single argument defaults to mode "r".
    if (parts.length === 1)
      continue;
    const isReadModeArgument = readOnlyOpenArgument.test(parts[1]!);
    if (!isReadModeArgument)
      return false;
  }
  return true;
}
