// Layer 6 test helpers: a fake page and a log and screenshot catcher.

import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { type HeadlessPage } from "../scripts/visual/cdp.ts";
import { failures } from "../scripts/visual/mockup-checks.ts";

const SCREENSHOT_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "scripts", "visual", "out");

export interface FakePage { page: HeadlessPage; evaluated: string[]; waited: string[]; navigations: string[] }

function pushCall(list: string[], value: string): string {
  list.push(value);
  return value;
}

export function createFakePage(answerFor: (expression: string) => unknown): FakePage {
  const fake: FakePage = { evaluated: [], waited: [], navigations: [], page: undefined as unknown as HeadlessPage };
  fake.page = {
    evaluate: async <T>(expression: string) => answerFor(pushCall(fake.evaluated, expression)) as T,
    waitFor: async (expression: string) => void pushCall(fake.waited, expression),
    navigate: async (url: string) => void pushCall(fake.navigations, url),
    screenshot: async () => "",
    close: async () => {},
  };
  return fake;
}

function readScreenshots(names: string[]): Map<string, Buffer | undefined> {
  const saved = new Map<string, Buffer | undefined>();
  for (const name of names) {
    const file = join(SCREENSHOT_DIR, name);
    saved.set(file, existsSync(file) ? readFileSync(file) : undefined);
  }
  return saved;
}

function resetScreenshots(saved: Map<string, Buffer | undefined>): void {
  for (const [file, bytes] of saved) {
    if (bytes === undefined)
      rmSync(file, { force: true });
    else
      writeFileSync(file, bytes);
  }
}

function replaceLog(lines: string[]): typeof console.log {
  const original = console.log;
  function pushLine(line: string): void {
    lines.push(line);
  }
  console.log = pushLine;
  return original;
}

// Runs the checks with console.log caught, the failure list restored and the named screenshots put back.
export async function collectLines(run: () => Promise<unknown>, screenshotNames: string[] = []): Promise<string[]> {
  const saved = readScreenshots(screenshotNames);
  const failuresBefore = failures.length;
  const lines: string[] = [];
  const original = replaceLog(lines);
  try {
    await run();
  }
  finally {
    console.log = original;
    failures.length = failuresBefore;
    resetScreenshots(saved);
  }
  return lines;
}

export function findLine(lines: string[], text: string): string {
  for (const line of lines) {
    const isMatch = line.includes(text);
    if (isMatch)
      return line;
  }
  throw new Error(`no line contains: ${text}`);
}
