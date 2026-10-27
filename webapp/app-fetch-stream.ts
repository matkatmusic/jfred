// NDJSON document-stream line handling: progress lines feed the console and bar, the last other line is the payload.

import type { WireConsentScript, WireDocument } from "./app-fetch.ts";
import { logProgress } from "./app-console.ts";
import { splitNdjsonChunk } from "./app-ndjson.ts";
import { showLoadingProgress } from "./app-progress.ts";

// Discriminated union for one NDJSON stream line; documents have no `kind`.
export type WireDocumentStreamLine = WireDocument & {
  kind?: "progress" | "error" | "consent-required" | "baseline-question";
  label?: string;
  current?: number;
  total?: number;
  scripts?: WireConsentScript[];
  baseCommit?: string;
  repo?: string;
};

// Drives both the console log and the progress bar (shimmer when no count; item 82).
function reportStreamProgress(parsed: WireDocumentStreamLine): void {
  logProgress(parsed.current !== undefined ? `${parsed.current}/${parsed.total} ${parsed.label}` : parsed.label!);
  const hasCount = parsed.current !== undefined && parsed.total !== undefined && parsed.total > 0;
  const fraction = hasCount ? parsed.current! / parsed.total! : Number.NaN;
  const detail = hasCount ? `${parsed.label} — ${parsed.current} / ${parsed.total}` : parsed.label!;
  showLoadingProgress(detail, fraction);
}

// Only the terminal document payload is this large; gating on size lets tiny lines parse inline (item 82).
const LARGE_PAYLOAD_BYTES = 200_000;

export function formatMegabytes(byteLength: number): string {
  return `${(byteLength / 1_000_000).toFixed(1)} MB`;
}

// Progress lines land in the console; each other line replaces the payload candidate, which is returned.
async function parseDocumentStreamLines(lines: string[], finalPayload: WireDocumentStreamLine): Promise<WireDocumentStreamLine> {
  for (const line of lines) {
    if (line.length > LARGE_PAYLOAD_BYTES) {
      // JSON.parse of this line blocks the tab; show a label and yield so the browser paints first.
      showLoadingProgress(`parsing document — ${formatMegabytes(line.length)}`, Number.NaN);
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    const parsed = JSON.parse(line) as WireDocumentStreamLine;
    if (parsed.kind === "progress") {
      reportStreamProgress(parsed);
    }
    else {
      finalPayload = parsed;
    }
  }
  return finalPayload;
}

// Read the whole NDJSON response body; returns the last non-progress line (document, consent decision, or error).
export async function readDocumentStream(response: Response): Promise<WireDocumentStreamLine> {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let remainder = "";
  let finalPayload!: WireDocumentStreamLine;
  for (;;) {
    const { value, done } = await reader.read();
    if (done)
      break;
    let lines: string[];
    ({ remainder, lines } = splitNdjsonChunk(remainder, decoder.decode(value, { stream: true })));
    finalPayload = await parseDocumentStreamLines(lines, finalPayload);
  }
  return finalPayload;
}
