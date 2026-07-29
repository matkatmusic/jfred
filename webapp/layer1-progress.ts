// Layer 1 progress strip and NDJSON reader; kept out of app-fetch.ts's classic-app dependency orbit on purpose.

import { getRequiredElementById } from "./app-dom.ts";
import { splitNdjsonChunk } from "./app-ndjson.ts";

// One stream line: progress/error lines carry `kind`, the terminal view none; strings duplicated since webapp/ cannot import src/.
interface Layer1StreamLine {
    kind?: "progress" | "error";
    label?: string;
    current?: number;
    total?: number;
}

// Where one progress line lands: the main strip by default, a pane-local bar when the caller passes its own.
export type ProgressPainter = (label: string, current?: number, total?: number) => void;

// Paint one fill+label pair; a countless stage shows the label alone so it never reads as a reset.
export function paintLoadbar(fill: HTMLElement, labelHost: HTMLElement, label: string, current?: number, total?: number): void {
    if (current === undefined || total === undefined || total <= 0) {
        labelHost.textContent = label;
        return;
    }
    labelHost.textContent = `${label} — ${current} / ${total}`;
    fill.style.width = `${(current / total) * 100}%`;
}

// Show or advance the main strip.
export function showLayer1Progress(label: string, current?: number, total?: number): void {
    getRequiredElementById("loadbar").removeAttribute("hidden");
    paintLoadbar(getRequiredElementById("loadbar-fill"), getRequiredElementById("loadbar-label"), label, current, total);
}

// Hide and reset the strip — fill, label AND cancel confirm — so the next load starts empty.
export function hideLayer1Progress(): void {
    getRequiredElementById("loadbar").setAttribute("hidden", "");
    getRequiredElementById("loadbar-fill").style.width = "0";
    getRequiredElementById("loadbar-label").textContent = "";
    getRequiredElementById("loadbar-confirm").setAttribute("hidden", "");
    getRequiredElementById("loadbar-cancel").removeAttribute("hidden");
}

// The in-flight load's controller. Module state: the button and the stream reader meet nowhere else.
let activeLoadController: AbortController | undefined = undefined;

export function cancelLayer1Load(): void {
    activeLoadController?.abort();
}

// Task 302: Cancel with in-DOM confirm, task-164 wording; aborts the fetch since this page is not hash-routed.
export function wireLayer1CancelButton(): void {
    const cancel = getRequiredElementById("loadbar-cancel");
    const confirmRow = getRequiredElementById("loadbar-confirm");
    cancel.addEventListener("click", () => {
        cancel.setAttribute("hidden", "");
        confirmRow.removeAttribute("hidden");
    });
    getRequiredElementById("loadbar-confirm-no").addEventListener("click", () => {
        confirmRow.setAttribute("hidden", "");
        cancel.removeAttribute("hidden");
    });
    getRequiredElementById("loadbar-confirm-yes").addEventListener("click", () => {
        cancelLayer1Load();
    });
}

// One chunk's complete lines: returns the terminal view if present; an error line throws immediately.
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

// Read the NDJSON stream, painting progress; throws on error line or non-2xx, returns undefined when cancelled.
export async function readLayer1ViewStream<ViewType>(url: string): Promise<ViewType | undefined> {
    const controller = new AbortController();
    activeLoadController = controller;
    try {
        const response = await fetch(url, { signal: controller.signal });
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
            // The view is always last, so this means the connection dropped mid-build — name it loudly.
            throw new Error("the Layer 1 stream ended before the view arrived");
        }
        return view;
    } catch (error) {
        // An abort is a clean stop the user asked for, never a crumb error.
        if (controller.signal.aborted) {
            return undefined;
        }
        throw error;
    }
}
