// The picker's refusal alert, split out of layer1-path-picker.ts to keep that file under the line cap.

import { getRequiredElementById } from "./app-dom.ts";
import { SourceKind } from "./layer1-wire.ts";

// What the folder held none of, named per kind so the message matches the list.
const EMPTY_ALERT_BY_KIND: Record<SourceKind, string> = {
  [SourceKind.jsonl]: "no JSONL files found",
  [SourceKind.fileHistory]: "no snapshots found",
};
const ALERT_VISIBLE_MS = 2600;

let alertTimer = 0;

// Shown briefly above the list, then auto-clears — the folder is refused, not the user.
export function hidePickerAlert(): void {
  getRequiredElementById("pp-alert").hidden = true;
}

export function reportEmptyFolder(kind: SourceKind): void {
  const alert = getRequiredElementById("pp-alert");
  alert.textContent = EMPTY_ALERT_BY_KIND[kind];
  alert.hidden = false;
  clearTimeout(alertTimer);
  alertTimer = setTimeout(hidePickerAlert, ALERT_VISIBLE_MS) as unknown as number;
}
