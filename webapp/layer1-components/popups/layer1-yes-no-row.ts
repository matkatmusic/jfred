// Layer 1 yes/no row: one small in-page question with two buttons.

import { createElement } from "../../app-dom.ts";

const ROW_ID = "yesno-row";

function closeRowWithAnswer(row: HTMLElement, resolve: (isYes: boolean) => void, isYes: boolean): void {
  row.remove();
  resolve(isYes);
}

export function openYesNoQuestion(question: string, yesText: string, noText: string): Promise<boolean> {
  const openRow = document.getElementById(ROW_ID);
  if (openRow !== null)
    throw new Error("a yes/no question is already open");
  return new Promise((resolve) => {
    const yesButton = createElement("button", { class: "yesno-yes", text: yesText, "data-component": "yesNoYesButton" });
    const noButton = createElement("button", { class: "yesno-no", text: noText, "data-component": "yesNoNoButton" });
    const row = createElement("div", { id: ROW_ID, class: "yesno-row", "data-component": "yesNoRow" }, [createElement("span", { text: question, "data-component": "yesNoQuestionText" }), yesButton, noButton]);
    const closeRowAsYes = (): void => closeRowWithAnswer(row, resolve, true);
    const closeRowAsNo = (): void => closeRowWithAnswer(row, resolve, false);
    yesButton.addEventListener("click", closeRowAsYes);
    noButton.addEventListener("click", closeRowAsNo);
    document.body.append(row);
  });
}
