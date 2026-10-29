// Pure helpers of the Layer 4 real-data checks: expression builders and payload lookups.

import { type WireScriptRunsView } from "../../webapp/layer1-wire-script-runs.ts";

type ScriptRun = WireScriptRunsView["pairs"][number]["scriptRuns"][number];

export const buildDotsOfRun = (toolUseId: string) =>
  `[...document.querySelectorAll('i.node.n-script[data-tool-use-id=${JSON.stringify(toolUseId)}]')]`;
export const buildConnectorOfRun = (toolUseId: string) =>
  `document.querySelector('#stage .script-connector[data-tool-use-id=${JSON.stringify(toolUseId)}]')`;
export const buildBubblePathExpression = (dot: string) => `${dot}.closest('.filebox').querySelector('.fname[data-path]').dataset.path`;

export function listRunsOnPaths(payload: WireScriptRunsView, paths: Set<string>): ScriptRun[] {
  const runs: ScriptRun[] = [];
  for (const pair of payload.pairs) {
    const isOnViewPath = paths.has(pair.path);
    if (isOnViewPath) {
      runs.push(...pair.scriptRuns);
    }
  }
  return runs;
}

export function findRunById(payload: WireScriptRunsView, toolUseId: string): ScriptRun | undefined {
  for (const pair of payload.pairs) {
    for (const run of pair.scriptRuns) {
      const isWanted = run.toolUseId === toolUseId;
      if (isWanted) {
        return run;
      }
    }
  }
  return undefined;
}

export function containsCountLabel(labels: string[]): boolean {
  for (const text of labels) {
    const isCountLabel = /\d+ \/ \d+/.test(text);
    if (isCountLabel) {
      return true;
    }
  }
  return false;
}

export function containsAll(haystack: string[], needles: string[]): boolean {
  for (const needle of needles) {
    const isMissing = !haystack.includes(needle);
    if (isMissing) {
      return false;
    }
  }
  return true;
}

export function getFirstCodeLine(code: string): string {
  for (const line of code.split("\n")) {
    const isCodeLine = line.trim() !== "";
    if (isCodeLine) {
      return line;
    }
  }
  return "";
}
