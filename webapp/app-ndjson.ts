// Dependency-free NDJSON splitting: standalone pages import this instead of app-fetch.ts.

// Split buffered NDJSON text into complete lines plus the trailing partial line.
export function splitNdjsonChunk(bufferedText: string, chunkText: string): { remainder: string; lines: string[] } {
  const combinedText = bufferedText + chunkText;
  const splitLines = combinedText.split("\n");
  const remainder = splitLines.pop()!;
  const lines: string[] = [];
  for (const line of splitLines) {
    const isNonEmpty = line.length > 0;
    if (isNonEmpty)
      lines.push(line);
  }
  return { remainder, lines };
}
