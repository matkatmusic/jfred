// Task 355: a page-blocking progress overlay for the Edit fetch; an error stays on it until the user closes it.

import { getRequiredElementById } from "./app-dom.ts";
import { cancelLayer1Load, paintLoadbar, type ProgressPainter } from "./layer1-progress.ts";

export const paintBusyShield: ProgressPainter = (label, current, total) => {
    paintLoadbar(getRequiredElementById("busy-fill"), getRequiredElementById("busy-label"), label, current, total);
};

export function openBusyShield(label: string): void {
    getRequiredElementById("busy-fill").style.width = "0";
    getRequiredElementById("busy-label").textContent = label;
    getRequiredElementById("busy-error").setAttribute("hidden", "");
    getRequiredElementById("busy-close").setAttribute("hidden", "");
    getRequiredElementById("busy-cancel").removeAttribute("hidden");
    getRequiredElementById("busy-shield").removeAttribute("hidden");
    getRequiredElementById("busy-cancel").focus();
}

export function showBusyShieldError(message: string): void {
    getRequiredElementById("busy-error").textContent = message;
    getRequiredElementById("busy-error").removeAttribute("hidden");
    getRequiredElementById("busy-close").removeAttribute("hidden");
    getRequiredElementById("busy-cancel").setAttribute("hidden", "");
}

export function closeBusyShield(): void {
    getRequiredElementById("busy-shield").setAttribute("hidden", "");
    getRequiredElementById("busy-error").textContent = "";
    getRequiredElementById("busy-fill").style.width = "0";
}

export function wireBusyShield(): void {
    getRequiredElementById("busy-cancel").addEventListener("click", cancelLayer1Load);
    getRequiredElementById("busy-close").addEventListener("click", closeBusyShield);
}
