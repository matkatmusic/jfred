// ─── NDJSON chunk splitting ────────────────────────────────────────────────── A dependency-free seam: a page that reads an NDJSON stream imports this instead of app-fetch.ts, which drags in the console, the progress indicator and the document cache at module scope — the whole classic-app stack a standalone page must avoid.

// Split buffered NDJSON text into complete lines plus the trailing partial line.
export function splitNdjsonChunk(bufferedText: string, chunkText: string): { remainder: string; lines: string[] } {
    const combinedText = bufferedText + chunkText;
    const splitLines = combinedText.split("\n");
    const remainder = splitLines.pop()!;
    const lines = splitLines.filter((line) => line.length > 0);
    return { remainder, lines };
}
