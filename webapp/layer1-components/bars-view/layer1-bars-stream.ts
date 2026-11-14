import type { InverseProgressLine, InverseReposWire } from "./layer1-bars-wire.ts";

// "/api/layer1-inverse-repos?" + params: dir, every jsonl, every snapshots, progress=1. Other keys are dropped.
export function buildInverseReposUrl(sourceParams: URLSearchParams): string {
    throw new Error("not built: buildInverseReposUrl");
}
// Reads NDJSON. Calls onProgressLine for EVERY progress line, in order. Returns the result line. Returns undefined when signal aborts.
// Throws: non-2xx response (the response text), an error line (its label), a stream that ends with no result line.
export function readInverseReposStream(url: string, onProgressLine: (line: InverseProgressLine) => void, signal: AbortSignal): Promise<InverseReposWire | undefined> {
    throw new Error("not built: readInverseReposStream");
}
