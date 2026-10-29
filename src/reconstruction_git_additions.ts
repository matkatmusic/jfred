// Line-addition diffs for git-evidence placement, split from reconstruction_git_placement.ts.

// A single inserted line, anchored to the base line it follows.
export type LineAddition = { anchor: string | undefined; line: string };

// Extracts pure insertions from base to blob; undefined if any base line was changed.
export function extractPureAdditions(baseLines: string[], blobLines: string[]): LineAddition[] | undefined {
  const additions: LineAddition[] = [];
  let baseIndex = 0;
  for (const line of blobLines) {
    const hasBaseLineLeft = baseIndex < baseLines.length;
    const matchesBaseLine = line === baseLines[baseIndex];
    const isBaseLineKept = hasBaseLineLeft && matchesBaseLine;
    if (isBaseLineKept) {
      baseIndex += 1;
      continue;
    }
    additions.push({ anchor: baseIndex > 0 ? baseLines[baseIndex - 1] : undefined, line });
  }
  const isBaseLineChanged = baseIndex !== baseLines.length;
  const hasNoAdditions = additions.length === 0;
  const isNotPureAddition = isBaseLineChanged || hasNoAdditions;
  if (isNotPureAddition)
    return undefined;
  return additions;
}

// Re-anchors additions onto a different base; undefined if any anchor is missing.
export function applyAdditions(lines: string[], additions: LineAddition[]): string[] | undefined {
  const result = [...lines];
  for (const { anchor, line } of additions) {
    if (anchor === undefined) {
      result.unshift(line);
      continue;
    }
    const at = result.lastIndexOf(anchor);
    if (at < 0)
      return undefined;
    result.splice(at + 1, 0, line);
  }
  return result;
}
