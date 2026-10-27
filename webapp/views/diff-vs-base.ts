// Diff-vs-Base view (#/project/<name>/file/<path>/vsbase): first revision against a selected revision.

import { createElement } from "../app-dom.ts";
import { getBaselineChoice, getConsentChoice } from "../app-choices.ts";
import {
  fetchDocument,
  fetchText,
} from "../app-fetch.ts";
import { renderConsentDialog } from "../app-consent.ts";
import { renderBaselineQuestionDialog } from "../app-baseline-question.ts";
import { routeToFileHistory } from "../app-routes.ts";
import { renderDiffText } from "./diff-text-render.ts";
import { buildFileHistoryViewModel, computeAnchoredRevisionIndex, type WireDocument as WireFileHistoryDocument } from "./file-history-model.ts";

// anchorRev (optional): 1-based revision to preselect instead of the last one.
export async function renderDiffVsBaseView(
  container: HTMLElement,
  project: string,
  target: string,
  anchorRev: string | undefined,
): Promise<void> {
  const result = await fetchDocument<WireFileHistoryDocument>(project, undefined);
  if (result.baselineQuestion !== undefined) {
    renderBaselineQuestionDialog(container, project, result.baselineQuestion);
    return;
  }
  if (result.consentRequired !== undefined) {
    renderConsentDialog(container, project, result.consentRequired);
    return;
  }
  const viewModel = buildFileHistoryViewModel(result.document!, target);
  const lastIndex = Math.max(viewModel.revisions.length - 1, 0);

  const revisionSelect = createElement("select", {}) as HTMLSelectElement;
  for (let index = 0; index < viewModel.revisions.length; index++) {
    const revision = viewModel.revisions[index]!;
    revisionSelect.append(createElement("option", { value: String(index), text: `#${index + 1} · ${revision.kind}` }));
  }
  const anchoredRevisionIndex = computeAnchoredRevisionIndex(anchorRev, viewModel.revisions.length);
  revisionSelect.value = String(anchoredRevisionIndex ?? lastIndex);

  const diffPane = createElement("div", { class: "diff-text" });
  const loadDiff = async () => {
    const params = new URLSearchParams({ project, file: target, mode: "vsbase", rev: revisionSelect.value });
    const consentChoice = getConsentChoice(project);
    if (consentChoice === "1")
      params.set("allowScripts", "1");
    // task 56: ride the stored pre-baseline answer so this hits the same cached document.
    const baselineChoice = getBaselineChoice(project);
    if (baselineChoice !== null)
      params.set("preBaseline", baselineChoice);
    renderDiffText(diffPane, await fetchText(`/api/diff?${params}`));
  };
  // URL sync lives here, not in loadDiff, so the first render never rewrites a bare /vsbase URL.
  const refreshRevisionDiff = async () => {
    await loadDiff();
    history.replaceState(null, "", `${routeToFileHistory(project, target)}/vsbase/${Number(revisionSelect.value) + 1}`);
  };
  revisionSelect.addEventListener("change", refreshRevisionDiff);

  container.append(createElement("div", { class: "filter-bar" }, [
    createElement("div", { class: "pane-title", text: `${target} · vs base` }),
    createElement("span", { class: "muted", text: "base #1 →" }),
    revisionSelect,
    // task 93: the route now opens THE Revision View (the File History view is retired).
    createElement("a", { href: routeToFileHistory(project, target), text: "← file revisions" }),
  ]));
  container.append(diffPane);
  await loadDiff();
}
