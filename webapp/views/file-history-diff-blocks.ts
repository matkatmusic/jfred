// Slices revision-timeline diff text into per-revision blocks.

// A kind header like "@@ changed @@" starts a block; numeric hunk headers do not.
function isRevisionBlockStart(line: string): boolean {
  const startsWithMarker = line.startsWith("@@");
  const startsWithHunkHeader = line.startsWith("@@ -");
  return startsWithMarker && !startsWithHunkHeader;
}

// Slice the revision-timeline diff text into per-revision blocks, each starting with its kind header line.
export function splitDiffBlocks(diffText: string): string[] {
  const blocks: string[] = [];
  let current: string[] | null = null;
  for (const line of diffText.split("\n")) {
    const isBlockStart = isRevisionBlockStart(line);
    if (isBlockStart) {
      if (current !== null) {
        blocks.push(current.join("\n"));
      }
      current = [line];
    }
    else if (current !== null) {
      current.push(line);
    }
  }
  if (current !== null) {
    blocks.push(current.join("\n"));
  }
  return blocks;
}
