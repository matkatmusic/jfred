// Git-apply patch emitter split from reconstruction_render_unified.ts.

// Splits text into lines and tracks trailing newline, since git needs the no-newline marker for byte-exact output.
function splitPatchLines(text: string): { lines: string[]; endsWithNewline: boolean } {
  if (text === "") {
    return { lines: [], endsWithNewline: true };
  }
  const endsWithNewline = text.endsWith("\n");
  const lines = text.split("\n");
  if (endsWithNewline) {
    lines.pop();
  }
  return { lines, endsWithNewline };
}

// One hunk side's lines prefixed with its sign, plus git's no-newline marker when needed.
function renderHunkSide(sign: string, text: string): string[] {
  const { lines, endsWithNewline } = splitPatchLines(text);
  const rendered: string[] = [];
  for (const line of lines) {
    rendered.push(sign + line);
  }
  if (!endsWithNewline) {
    rendered.push("\\ No newline at end of file");
  }
  return rendered;
}

// Whole-file replacement hunk valid for `git apply`; undefined marks creation/deletion. ponytail: add LCS hunks only if size matters.
export function renderGitFileDiff(
  relativePath: string,
  beforeText: string | undefined,
  afterText: string | undefined,
): string {
  const headerLines = [`diff --git a/${relativePath} b/${relativePath}`];
  if (beforeText === undefined) {
    headerLines.push("new file mode 100644");
  }
  if (afterText === undefined) {
    headerLines.push("deleted file mode 100644");
  }
  const beforeCount = splitPatchLines(beforeText ?? "").lines.length;
  const afterCount = splitPatchLines(afterText ?? "").lines.length;
  const hasNoBeforeLines = beforeCount === 0;
  const hasNoAfterLines = afterCount === 0;
  const isEmptyBlock = hasNoBeforeLines && hasNoAfterLines;
  if (isEmptyBlock) {
    // Empty creation/deletion: the mode line alone is the whole (valid) block.
    return headerLines.join("\n") + "\n";
  }
  const oldPath = beforeText === undefined ? "/dev/null" : `a/${relativePath}`;
  const newPath = afterText === undefined ? "/dev/null" : `b/${relativePath}`;
  const hunkHeader = `@@ -${hasNoBeforeLines ? 0 : 1},${beforeCount} +${hasNoAfterLines ? 0 : 1},${afterCount} @@`;
  return [
    ...headerLines,
    `--- ${oldPath}`,
    `+++ ${newPath}`,
    hunkHeader,
    ...renderHunkSide("-", beforeText ?? ""),
    ...renderHunkSide("+", afterText ?? ""),
  ].join("\n") + "\n";
}
