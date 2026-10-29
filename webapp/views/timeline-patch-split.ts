// Splits a multi-file range patch into per-file blocks.

type PatchBlock = { path: string; lines: string[] };

// Close the open block and open a new one keyed by the header's b/ path.
function createNextPatchBlock(line: string, current: PatchBlock | null, blocks: PatchBlock[]): PatchBlock {
  if (current !== null) {
    blocks.push(current);
  }
  return { path: line.slice(line.lastIndexOf(" b/") + 3), lines: [line] };
}

// Split on `diff --git ` headers into per-file blocks keyed by patch-relative path.
export function splitPatchByFile(patchText: string): { path: string; block: string }[] {
  const blocks: PatchBlock[] = [];
  let current: PatchBlock | null = null;
  for (const line of patchText.split("\n")) {
    const isFileHeader = line.startsWith("diff --git ");
    if (isFileHeader) {
      current = createNextPatchBlock(line, current, blocks);
      continue;
    }
    if (current !== null) {
      current.lines.push(line);
    }
  }
  if (current !== null) {
    blocks.push(current);
  }
  const fileBlocks: { path: string; block: string }[] = [];
  for (const entry of blocks) {
    fileBlocks.push({ path: entry.path, block: entry.lines.join("\n") });
  }
  return fileBlocks;
}
