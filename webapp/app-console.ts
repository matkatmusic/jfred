// ─── loading console (xterm.js, lazily created) ──────────────────────────────

import type { Terminal as XtermTerminal } from "@xterm/xterm";
import type { FitAddon as XtermFitAddon } from "@xterm/addon-fit";
import { parseRouteSegments, routeToTimeline } from "./app-routes.ts";

// xterm.js is loaded as browser globals via <script> tags (webapp/vendor) — type those globals
// here instead of value-importing the packages (a bundler-less build cannot resolve bare
// module specifiers; the type-only imports above are erased at emit).
declare global {
    const Terminal: typeof XtermTerminal;
    const FitAddon: { FitAddon: typeof XtermFitAddon };
    interface Window {
        progressTerminal: XtermTerminal;
    }
}

export let progressTerminal: XtermTerminal | null = null;
let progressFitAddon: XtermFitAddon | null = null;
const CONSOLE_ROWS = 15;

// The loading console is a persistent, full-width strip docked at the bottom of the window
// (#progress-console in index.html), exactly CONSOLE_ROWS text rows tall. It is created once and reused for
// every load, so it survives route re-renders (which wipe #view) — progress lines accumulate and
// the last load's output stays visible until the next. The theme reads the app's live CSS vars.
export function ensureProgressTerminal(): void {
    if (progressTerminal !== null) return;
    const rootStyles = getComputedStyle(document.documentElement);
    progressTerminal = new Terminal({
        rows: CONSOLE_ROWS,
        disableStdin: true,
        convertEol: true,
        scrollback: 10000,
        // Right-click selects the word under the cursor; xterm then mirrors the selection into
        // its hidden textarea, so the browser's NATIVE context menu (Copy etc.) works on it.
        rightClickSelectsWord: true,
        theme: {
            background: rootStyles.getPropertyValue("--code-bg").trim(),
            foreground: rootStyles.getPropertyValue("--muted").trim(),
            // xterm's DEFAULT selection overlay is translucent white — invisible on the light
            // palette's white --code-bg, so selecting "didn't work" visually. Accent at ~35%
            // alpha (hex AA suffix) is visible on both palettes.
            selectionBackground: rootStyles.getPropertyValue("--accent").trim() + "59",
        },
    });
    // Debug handle: lets devtools (and headless tests) drive the selection API directly,
    // e.g. progressTerminal.select(0, 0, 20) — this app is itself a debugging surface.
    window.progressTerminal = progressTerminal;
    progressFitAddon = new FitAddon.FitAddon();
    progressTerminal.loadAddon(progressFitAddon);
    // Copy-on-select, like a real terminal: xterm draws its own selection layer instead of the
    // browser's, so mirror every selection straight to the clipboard via the selection API
    // (getSelection/onSelectionChange — xtermjs.org/docs/api/terminal/classes/terminal/#select).
    // ponytail: clipboard failure is silently ignored — a copy convenience, not a data path.
    progressTerminal.onSelectionChange(() => {
        const selection = progressTerminal!.getSelection();
        if (selection) navigator.clipboard.writeText(selection).catch(() => {});
    });
    progressTerminal.open(document.getElementById("progress-console")!);
    // Progress labels ending in "[<file>.jsonl:<line>]" become clickable links to the timeline,
    // anchored at that raw line. The project comes from the current hash: the console outlives
    // route changes, so a stale line clicked from a different project routes into the CURRENT
    // project and fails into the existing error box.
    // ponytail: not worth guarding — xterm draws hover underline + pointer itself.
    progressTerminal.registerLinkProvider({
        provideLinks(bufferLineNumber, callback) {
            const lineText = progressTerminal!.buffer.active.getLine(bufferLineNumber - 1)?.translateToString(true) ?? "";
            const sourceLink = matchJsonlSourceLink(lineText);
            if (sourceLink === undefined) {
                callback(undefined);
                return;
            }
            callback([{
                text: sourceLink.tokenText,
                range: {
                    // xterm buffer coordinates are 1-based; the end cell is inclusive.
                    start: { x: sourceLink.tokenStartIndex + 1, y: bufferLineNumber },
                    end: { x: sourceLink.tokenStartIndex + sourceLink.tokenText.length, y: bufferLineNumber },
                },
                activate: () => {
                    const segments = parseRouteSegments();
                    if (segments[0] !== "project") {
                        return;
                    }
                    location.hash = routeToTimeline(segments[1]!, sourceLink.jsonlFileName, String(sourceLink.rawLineIndex));
                },
            }]);
        },
    });
    document.getElementById("progress-copy")!.onclick = copyConsoleText;
    fitProgressColumns();
    window.addEventListener("resize", fitProgressColumns);
    // The window-resize listener misses width changes with no resize event — chiefly
    // dragging the sidebar↔rightcol splitter (#split-lr), which narrows the console.
    // A ResizeObserver on the console element re-fits `cols` on ANY box change, so
    // xterm always wraps at the visible width instead of overflowing (clipped) it (item 80).
    const consoleResizeObserver = new ResizeObserver(() => fitProgressColumns());
    consoleResizeObserver.observe(document.getElementById("progress-console")!);
}

// The console's full scrollback as plain text — what the copy button puts on the clipboard.
function collectConsoleText(): string {
    const buffer = progressTerminal!.buffer.active;
    const lines = [];
    for (let i = 0; i < buffer.length; i += 1) {
        lines.push(buffer.getLine(i)?.translateToString(true) ?? "");
    }
    return lines.join("\n").trimEnd();
}

function copyConsoleText(): void {
    const button = document.getElementById("progress-copy")!;
    navigator.clipboard.writeText(collectConsoleText()).then(() => {
        button.textContent = "copied";
        setTimeout(() => { button.textContent = "copy"; }, 1200);
    }).catch(() => {});
}

// Fit BOTH cols and rows to the console box. Forcing CONSOLE_ROWS (15) rows made xterm render
// one more row than the fixed-height box (styles.css #console-row: 255px minus header + padding)
// could show, so `overflow: hidden` clipped the last line below the fold and scrollToBottom
// couldn't rescue it (item 81). proposeDimensions() reports the rows that actually fit — use them.
function fitProgressColumns(): void {
    const dimensions = progressFitAddon?.proposeDimensions();
    // if (dimensions?.cols) progressTerminal!.resize(dimensions.cols, CONSOLE_ROWS);
    if (dimensions?.cols && dimensions?.rows) progressTerminal!.resize(dimensions.cols, dimensions.rows);
}

// ─── console collapse (item 66): row ⇄ one-line status bar ──────────────────

// The last non-empty line of the xterm scrollback — the status the collapsed bar shows.
function findLastNonEmptyConsoleLine(): string {
    const buffer = progressTerminal!.buffer.active;
    for (let i = buffer.length - 1; i >= 0; i -= 1) {
        const lineText = buffer.getLine(i)?.translateToString(true).trim() ?? "";
        if (lineText.length > 0) {
            return lineText;
        }
    }
    return "";
}

// Swap the console row for the #console-bar status strip (#rightcol.console-collapsed CSS).
export function collapseProgressConsole(): void {
    document.getElementById("rightcol")!.classList.add("console-collapsed");
    document.getElementById("console-last")!.textContent =
        progressTerminal === null ? "" : findLastNonEmptyConsoleLine();
}

export function expandProgressConsole(): void {
    document.getElementById("rightcol")!.classList.remove("console-collapsed");
    // The row was display:none while collapsed — re-fit the column count to its width.
    fitProgressColumns();
}

// Local wall-clock HH:MM:SS.mmm — ms precision because most loading work is sub-second.
function formatConsoleTime(): string {
    const now = new Date();
    const pad = (value: number, width = 2) => String(value).padStart(width, "0");
    return `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}.${pad(now.getMilliseconds(), 3)}`;
}

// The console line with its "[<jsonl>:<line>]" source token tinted cyan, so the clickable jump
// stands out from the timestamp and the action description. ANSI colors become xterm cell
// attributes, not buffer text, so matchJsonlSourceLink and the link provider still see the
// plain token.
function tintSourceToken(text: string): string {
    const link = matchJsonlSourceLink(text);
    if (link === undefined) {
        return text;
    }
    const before = text.slice(0, link.tokenStartIndex);
    const after = text.slice(link.tokenStartIndex + link.tokenText.length);
    return `${before}\x1b[36m${link.tokenText}\x1b[0m${after}`;
}

export function logProgress(text: string): void {
    ensureProgressTerminal();
    // writeln is async; scroll in its completion callback so the buffer reflects the new line
    progressTerminal!.writeln(`${formatConsoleTime()} ${tintSourceToken(text)}`, () => progressTerminal!.scrollToBottom());
}

// The "[<file>.jsonl:<line>]" source token of a console line (formatRunSource emits at most one
// per label), or undefined when the line has none. Labels carry 1-based transcript line numbers;
// rawLineIndex converts to the 0-based index used by /at/ anchors and rawLines arrays.
export function matchJsonlSourceLink(lineText: string): { jsonlFileName: string; rawLineIndex: number; tokenStartIndex: number; tokenText: string } | undefined {
    const match = /\[([\w.-]+\.jsonl):(\d+)\]/.exec(lineText);
    if (match === null) {
        return undefined;
    }
    return {
        jsonlFileName: match[1]!,
        rawLineIndex: Number(match[2]) - 1,
        tokenStartIndex: match.index,
        tokenText: match[0]!,
    };
}
