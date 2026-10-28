// ─── loading console (xterm.js, lazily created) ──────────────────────────────

import type { ILink, Terminal as XtermTerminal } from "@xterm/xterm";
import type { FitAddon as XtermFitAddon } from "@xterm/addon-fit";
import { parseRouteSegments, getTimelineRoute } from "./app-routes.ts";
import { collectBufferText, findLastNonEmptyBufferLine, formatConsoleTime, formatTintedSourceToken, matchJsonlSourceLink } from "./app-console-text.ts";

// xterm.js loads as browser globals via script tags, so type them here instead of value-importing.
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

// The loading console (#progress-console) is created once and reused, so it survives route re-renders.
function openSourceLinkTimeline(sourceLink: NonNullable<ReturnType<typeof matchJsonlSourceLink>>): void {
  const segments = parseRouteSegments();
  if (segments[0] !== "project") {
    return;
  }
  location.hash = getTimelineRoute(segments[1]!, sourceLink.jsonlFileName, String(sourceLink.rawLineIndex));
}

function buildConsoleSourceLinks(bufferLineNumber: number, callback: (links: ILink[] | undefined) => void): void {
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
    activate: () => openSourceLinkTimeline(sourceLink),
  }]);
}

// ponytail: clipboard failure is silently ignored — a copy convenience, not a data path.
function clearClipboardFailure(): void {}

function copySelectionToClipboard(): void {
  const selection = progressTerminal!.getSelection();
  if (selection)
    navigator.clipboard.writeText(selection).catch(clearClipboardFailure);
}

export function initProgressTerminal(): void {
  if (progressTerminal !== null)
    return;
  const rootStyles = getComputedStyle(document.documentElement);
  progressTerminal = new Terminal({
    rows: CONSOLE_ROWS,
    disableStdin: true,
    convertEol: true,
    scrollback: 10000,
    // Right-click selects a word, so the browser's native context menu can copy it.
    rightClickSelectsWord: true,
    theme: {
      background: rootStyles.getPropertyValue("--code-bg").trim(),
      foreground: rootStyles.getPropertyValue("--muted").trim(),
      // The default white selection overlay vanishes on the light palette; accent at ~35% alpha shows on both.
      selectionBackground: rootStyles.getPropertyValue("--accent").trim() + "59",
    },
  });
  // Debug handle: lets devtools and headless tests drive the selection API directly.
  window.progressTerminal = progressTerminal;
  progressFitAddon = new FitAddon.FitAddon();
  progressTerminal.loadAddon(progressFitAddon);
  // Copy-on-select, like a real terminal: mirror every xterm selection to the clipboard.
  progressTerminal.onSelectionChange(copySelectionToClipboard);
  progressTerminal.open(document.getElementById("progress-console")!);
  // Labels ending in "[<file>.jsonl:<line>]" become links to that raw line in the CURRENT project's timeline.
  // ponytail: not worth guarding — xterm draws hover underline + pointer itself.
  progressTerminal.registerLinkProvider({ provideLinks: buildConsoleSourceLinks });
  document.getElementById("progress-copy")!.onclick = copyConsoleText;
  updateProgressSize();
  window.addEventListener("resize", updateProgressSize);
  // A ResizeObserver also catches splitter drags, which fire no window resize event (item 80).
  const consoleResizeObserver = new ResizeObserver(() => updateProgressSize());
  consoleResizeObserver.observe(document.getElementById("progress-console")!);
}

function resetCopyLabel(): void {
  document.getElementById("progress-copy")!.textContent = "copy";
}

function setCopiedLabel(): void {
  document.getElementById("progress-copy")!.textContent = "copied";
  setTimeout(resetCopyLabel, 1200);
}

function copyConsoleText(): void {
  const written = navigator.clipboard.writeText(collectBufferText(progressTerminal!));
  written.then(setCopiedLabel).catch(clearClipboardFailure);
}

// Fit BOTH cols and rows: forcing CONSOLE_ROWS clipped the last line below the fold (item 81).
function updateProgressSize(): void {
  const dimensions = progressFitAddon?.proposeDimensions();
  // if (dimensions?.cols) progressTerminal!.resize(dimensions.cols, CONSOLE_ROWS);
  const hasCols = Boolean(dimensions?.cols);
  const hasRows = Boolean(dimensions?.rows);
  const hasSize = hasCols && hasRows;
  if (hasSize)
    progressTerminal!.resize(dimensions!.cols, dimensions!.rows);
}

// ─── console collapse (item 66): row ⇄ one-line status bar ──────────────────

// Swap the console row for the #console-bar status strip (#rightcol.console-collapsed CSS).
export function closeProgressConsole(): void {
  document.getElementById("rightcol")!.classList.add("console-collapsed");
  document.getElementById("console-last")!.textContent =
    progressTerminal === null ? "" : findLastNonEmptyBufferLine(progressTerminal);
}

export function openProgressConsole(): void {
  document.getElementById("rightcol")!.classList.remove("console-collapsed");
  // The row was display:none while collapsed — re-fit the column count to its width.
  updateProgressSize();
}

function moveConsoleToBottom(): void {
  progressTerminal!.scrollToBottom();
}

export function logProgress(text: string): void {
  initProgressTerminal();
  // writeln is async; scroll in its completion callback so the buffer reflects the new line
  progressTerminal!.writeln(`${formatConsoleTime()} ${formatTintedSourceToken(text)}`, moveConsoleToBottom);
}
