// Test support: a fake page that answers Layer 9 expressions from canned facts.

import { type HeadlessPage } from "../scripts/visual/cdp.ts";
import { failures } from "../scripts/visual/mockup-checks.ts";

// Answers queue per expression and the last repeats; an unknown expression answers undefined.
export type Answers = Map<string, unknown[]>;

export function makeScriptedPage(answers: Answers): HeadlessPage {
  const readNext = (expression: string): unknown => {
    const queue = answers.get(expression);
    if (queue === undefined)
      return undefined;
    return queue.length > 1 ? queue.shift() : queue[0];
  };
  return {
    evaluate: async <T>(expression: string) => readNext(expression) as T,
    waitFor: async () => {}, navigate: async () => {}, screenshot: async () => "", close: async () => {},
  };
}

// Runs one check and returns the failed titles and the printed lines.
export async function runCheck(check: () => Promise<void>): Promise<{ newFailures: string[]; lines: string[] }> {
  const failuresBefore = failures.length;
  const log = console.log;
  const lines: string[] = [];
  console.log = (line: string) => {
    lines.push(line);
  };
  try {
    await check();
    return { newFailures: failures.slice(failuresBefore), lines };
  }
  finally {
    console.log = log;
    failures.length = failuresBefore;
  }
}
