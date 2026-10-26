// The "project settings" toggle shows or hides the Project folder and Git repo rows; it remembers nothing.

import { getRequiredElementById } from "./app-dom.ts";

function toggleProjectSettingsRows(): void {
  const isOpen = document.querySelector(".viz-root")!.classList.toggle("project-settings-open");
  getRequiredElementById("project-settings").classList.toggle("current", isOpen);
}

export function installProjectSettingsToggle(): void {
  getRequiredElementById("project-settings").addEventListener("click", toggleProjectSettingsRows);
}
