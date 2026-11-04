// Header clear button: wipes saved results after an inline confirm, then recomputes every layer.

import { getRequiredElementById } from "./app-dom.ts";
import { openBusyShield, renderBusyShieldError } from "./layer1-busy-shield.ts";
import { resetRunQueue } from "./layer1-run-queue.ts";
import { resetRunResults } from "./layer1-run-results.ts";

async function sendClearResults(reload: () => void): Promise<void> {
  resetRunQueue();
  const response = await fetch("/api/layer1-clear-results", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  if (!response.ok) {
    throw new Error(`clear results failed: ${response.status}`);
  }
  resetRunResults();
  // ponytail: a run that finishes during the POST stays saved; a pause flag closes it.
  resetRunQueue();
  reload();
}

function reportClearFailure(error: unknown): void {
  openBusyShield("clear results failed");
  renderBusyShieldError(String(error));
}

function openConfirmRow(clear: HTMLElement, confirmRow: HTMLElement): void {
  clear.setAttribute("hidden", "");
  confirmRow.removeAttribute("hidden");
}

function hideConfirmRow(clear: HTMLElement, confirmRow: HTMLElement): void {
  confirmRow.setAttribute("hidden", "");
  clear.removeAttribute("hidden");
}

export function attachClearResultsButton(reload: () => void): void {
  const clear = getRequiredElementById("clear-results");
  const confirmRow = getRequiredElementById("clear-results-confirm");
  const openConfirm = (): void => openConfirmRow(clear, confirmRow);
  const closeConfirm = (): void => hideConfirmRow(clear, confirmRow);
  const sendAndClose = (): void => {
    closeConfirm();
    void sendClearResults(reload).catch(reportClearFailure);
  };
  clear.addEventListener("click", openConfirm);
  getRequiredElementById("clear-results-no").addEventListener("click", closeConfirm);
  getRequiredElementById("clear-results-yes").addEventListener("click", sendAndClose);
}
