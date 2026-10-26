// The script-run drawer's three native <details> folds.

import { createElement } from "./app-dom.ts";

// One fold: the summary is always visible, the body shows while open.
export function buildScriptRunFold(className: string, summary: HTMLElement, body: HTMLElement[], open: boolean): HTMLDetailsElement {
  const fold = createElement("details", { class: className }, [summary, ...body]) as HTMLDetailsElement;
  fold.open = open;
  return fold;
}

// Fold 1: the title with its affected-file count, closed over the file list.
export function buildScriptRunFileFold(title: string, paths: string[]): HTMLDetailsElement {
  const summary = createElement("summary", { text: `${title} · ${paths.length} affected file(s)` });
  return buildScriptRunFold("script-files-fold", summary, [createElement("div", { text: paths.join("\n") })], false);
}
