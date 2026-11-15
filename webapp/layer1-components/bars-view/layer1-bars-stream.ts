import { splitNdjsonChunk } from "../../app-ndjson.ts";
import type { InverseProgressLine, InverseReposWire } from "./layer1-bars-wire.ts";

const INVERSE_REPOS_PATH = "/api/layer1-inverse-repos";
const KEPT_SOURCE_PARAM_KEYS = ["dir", "jsonl", "snapshots"];

type StreamLine = { kind?: string; label?: string };

// "/api/layer1-inverse-repos?" + params: dir, every jsonl, every snapshots, progress=1. Other keys are dropped.
export function buildInverseReposUrl(sourceParams: URLSearchParams): string {
    const urlParams = new URLSearchParams();
    for (const key of KEPT_SOURCE_PARAM_KEYS) {
        for (const value of sourceParams.getAll(key)) {
            urlParams.append(key, value);
        }
    }
    urlParams.append("progress", "1");
    return INVERSE_REPOS_PATH + "?" + urlParams.toString();
}

// Hand progress lines to the callback, throw on an error line, return the result line if this batch holds one.
function applyStreamLines(lineTexts: string[], onProgressLine: (line: InverseProgressLine) => void): InverseReposWire | undefined {
    let result: InverseReposWire | undefined = undefined;
    for (const lineText of lineTexts) {
        const parsedLine = JSON.parse(lineText) as StreamLine;
        if (parsedLine.kind === "progress") {
            onProgressLine(parsedLine as InverseProgressLine);
        }
        else if (parsedLine.kind === "error") {
            throw new Error(parsedLine.label);
        }
        else {
            result = parsedLine as unknown as InverseReposWire;
        }
    }
    return result;
}

// Reads NDJSON. Calls onProgressLine for EVERY progress line, in order. Returns the result line. Returns undefined when signal aborts.
// Throws: non-2xx response (the response text), an error line (its label), a stream that ends with no result line.
export async function readInverseReposStream(url: string, onProgressLine: (line: InverseProgressLine) => void, signal: AbortSignal): Promise<InverseReposWire | undefined> {
    // The signal is not given to fetch: an aborted fetch rejects, and the abort here cancels the reader so a pending read ends clean.
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(await response.text());
    }
    const reader = response.body!.getReader();
    const cancelReader = (): void => {
        void reader.cancel();
    };
    signal.addEventListener("abort", cancelReader);
    const decoder = new TextDecoder();
    let remainder = "";
    let result: InverseReposWire | undefined = undefined;
    for (;;) {
        if (signal.aborted) {
            cancelReader();
            return undefined;
        }
        const { value, done } = await reader.read();
        if (done) {
            break;
        }
        let lines: string[];
        ({ remainder, lines } = splitNdjsonChunk(remainder, decoder.decode(value, { stream: true })));
        result = applyStreamLines(lines, onProgressLine) ?? result;
    }
    signal.removeEventListener("abort", cancelReader);
    if (signal.aborted) {
        return undefined;
    }
    if (result === undefined) {
        throw new Error("the inverse repos stream ended with no result line");
    }
    return result;
}
