// Task 56 dialog: asks whether to reconstruct file states that precede the baseline commit.

import { createElement } from "./app-dom.ts";
import { storeBaselineChoice } from "./app-choices.ts";
import { type WireBaselineQuestion } from "./app-fetch.ts";
import { renderRoute } from "./app-router.ts";

// The short display form of a full commit hash (git's customary 12 abbreviated digits).
export function formatShortCommitHash(commitHash: string): string {
  return commitHash.slice(0, 12);
}

export function renderBaselineQuestionDialog(container: HTMLElement, project: string, question: WireBaselineQuestion): void {
  // Store the answer, then re-render so the document request carries it as preBaseline.
  const storeChoiceAndRender = (choice: string) => {
    storeBaselineChoice(project, choice);
    renderRoute();
  };
  const reconstructButton = createElement("button", {
    class: "toolbar-btn consent-run",
    text: "Reconstruct pre-baseline states",
    onclick: () => storeChoiceAndRender("1"),
  });
  const startAtBaselineButton = createElement("button", {
    class: "toolbar-btn",
    text: "Start at the baseline commit",
    onclick: () => storeChoiceAndRender("0"),
  });
  const box = createElement("div", { class: "consent-box" }, [
    createElement("div", { class: "consent-header" }, [
      createElement("h2", { text: "Do you want to reconstruct file states that precede the supplied baseline git commit?" }),
      createElement("div", { class: "muted", text: `repo ${question.repo} · commit ${formatShortCommitHash(question.baseCommit)}` }),
      reconstructButton,
      startAtBaselineButton,
    ]),
  ]);
  container.replaceChildren(box);
}
