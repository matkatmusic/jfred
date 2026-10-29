// Console text helpers: source-token matching, timestamps, tinting, and xterm scrollback reads.

import type { Terminal as XtermTerminal } from "@xterm/xterm";

// The "[<file>.jsonl:<line>]" token of a console line, or undefined; rawLineIndex is the 0-based form of the 1-based label.
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

function formatDigits(value: number, width = 2): string {
  return String(value).padStart(width, "0");
}

// Local wall-clock HH:MM:SS.mmm — ms precision because most loading work is sub-second.
export function formatConsoleTime(): string {
  const now = new Date();
  return `${formatDigits(now.getHours())}:${formatDigits(now.getMinutes())}:${formatDigits(now.getSeconds())}.${formatDigits(now.getMilliseconds(), 3)}`;
}

// The line with its source token tinted cyan; ANSI colors are cell attributes, so the buffer text stays plain.
export function formatTintedSourceToken(text: string): string {
  const link = matchJsonlSourceLink(text);
  if (link === undefined) {
    return text;
  }
  const before = text.slice(0, link.tokenStartIndex);
  const after = text.slice(link.tokenStartIndex + link.tokenText.length);
  return `${before}\x1b[36m${link.tokenText}\x1b[0m${after}`;
}

// The terminal's full scrollback as plain text — what the copy button puts on the clipboard.
export function collectBufferText(terminal: XtermTerminal): string {
  const buffer = terminal.buffer.active;
  const lines = [];
  for (let i = 0; i < buffer.length; i += 1) {
    lines.push(buffer.getLine(i)?.translateToString(true) ?? "");
  }
  return lines.join("\n").trimEnd();
}

// The last non-empty line of the terminal scrollback — the status the collapsed bar shows.
export function findLastNonEmptyBufferLine(terminal: XtermTerminal): string {
  const buffer = terminal.buffer.active;
  for (let i = buffer.length - 1; i >= 0; i -= 1) {
    const line = buffer.getLine(i);
    const lineText = line?.translateToString(true).trim() ?? "";
    if (lineText.length > 0) {
      return lineText;
    }
  }
  return "";
}
