// The Layer 1 page's progress strip and its NDJSON stream reader (S18 feedback fixes, step 4c).  Kept out of layer1-page.ts so that file stays near its ~250-line neighbours, and out of app-fetch.ts's orbit entirely: that module pulls in app-console.ts, app-progress.ts and the document cache at module scope, which is the whole-classic-app dependency this page deliberately avoids. Only the dependency-free splitter in app-ndjson.ts is shared.

import { getRequiredElementById } from "./app-dom.ts";
import { splitNdjsonChunk } from "./app-ndjson.ts";

// One line of the /api/layer1-view?progress=1 stream. Progress and error lines carry `kind`; the terminal view carries none, exactly as /api/document frames its own stream. The two kind strings are spelled here rather than imported because webapp/ may not import src/ — the same duplication app-fetch.ts already lives with.
interface Layer1StreamLine {
    kind?: "progress" | "error";
    label?: string;
    current?: number;
    total?: number;
}

// Show or advance the strip. A counted event fills it; a countless stage shows the label alone and leaves the fill where it was, so a stage with no N does not read as a reset to zero.
export function showLayer1Progress(label: string, current?: number, total?: number): void {
    getRequiredElementById("loadbar").removeAttribute("hidden");
    if (current === undefined || total === undefined || total <= 0) {
        getRequiredElementById("loadbar-label").textContent = label;
        return;
    }
    getRequiredElementById("loadbar-label").textContent = `${label} — ${current} / ${total}`;
    getRequiredElementById("loadbar-fill").style.width = `${(current / total) * 100}%`;
}

// Hide the strip and reset it, so the next load starts empty rather than resuming the last one.
export function hideLayer1Progress(): void {
    getRequiredElementById("loadbar").setAttribute("hidden", "");
    getRequiredElementById("loadbar-fill").style.width = "0";
    getRequiredElementById("loadbar-label").textContent = "";
}

// One decoded chunk's complete lines: the terminal view when this chunk held it, otherwise undefined. An error line throws immediately — the caller has a single failure path.
//
// ponytail: only the LAST progress line of a chunk reaches the DOM. One reader.read() typically delivers many of the 832 lines at once and the intermediate ones are never painted, so this is one `.at(-1)` rather than 832 style writes.
function applyStreamLines<ViewType>(lines: string[]): ViewType | undefined {
    const progressLines: Layer1StreamLine[] = [];
    let view: ViewType | undefined = undefined;
    for (const line of lines) {
        const parsed = JSON.parse(line) as Layer1StreamLine;
        if (parsed.kind === "error") {
            throw new Error(parsed.label);
        }
        if (parsed.kind === "progress") {
            progressLines.push(parsed);
            continue;
        }
        view = parsed as ViewType;
    }
    const latest = progressLines.at(-1);
    if (latest !== undefined) {
        showLayer1Progress(latest.label ?? "", latest.current, latest.total);
    }
    return view;
}

// Read the NDJSON stream, advancing the bar as lines arrive, and return the terminal view. Throws on a terminal error line AND on a non-2xx response, so the one caller has a single failure path: a 400 from a bad `dir`/`repo` never opens a stream at all. Named `read…`, not `stream…`, to keep it distinct from the server function of that name in src/viewer_api_layer1_route.ts.
export async function readLayer1ViewStream<ViewType>(url: string): Promise<ViewType> {
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(await response.text());
    }
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let remainder = "";
    let view: ViewType | undefined = undefined;
    for (;;) {
        const { value, done } = await reader.read();
        if (done) {
            break;
        }
        let lines: string[];
        ({ remainder, lines } = splitNdjsonChunk(remainder, decoder.decode(value, { stream: true })));
        view = applyStreamLines<ViewType>(lines) ?? view;
    }
    if (view === undefined) {
        // Every successful build ends with the view, so this means the connection dropped mid-build — worth naming rather than rendering an empty page that looks like a repo with no files.
        throw new Error("the Layer 1 stream ended before the view arrived");
    }
    return view;
}
