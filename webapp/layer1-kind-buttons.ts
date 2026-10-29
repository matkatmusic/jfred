// Task 343: the [3] and [4] buttons tick the Edit and script run boxes through the box code path.

import { getRequiredElementById } from "./app-dom.ts";
import { toggleKindBox } from "./layer1-kind-filter.ts";
import { ShowRowKind } from "./layer1-show-row.ts";

function findKindBox(kind: ShowRowKind): HTMLInputElement {
  return document.querySelector<HTMLInputElement>(`#show-row input[data-kind="${kind}"]`)!;
}

// The [3] button clicks the Edit box, so both share one code path.
function markEditBoxChecked(): void {
  const box = findKindBox(ShowRowKind.edit);
  if (!box.checked) {
    box.click();
  }
}

// Spec S21.9: [4] implies [3]. The loads run one after the other: they share one busy shield.
export async function markEditAndScriptRunBoxesChecked(): Promise<void> {
  for (const kind of [ShowRowKind.edit, ShowRowKind.scriptRun]) {
    const box = findKindBox(kind);
    if (!box.checked) {
      box.checked = true;
      await toggleKindBox(box);
    }
    if (!box.checked) {
      return;
    }
  }
}

// Assigned, not added, so a re-render never stacks listeners.
export function attachKindButtons(): void {
  getRequiredElementById("layer-3").onclick = markEditBoxChecked;
  getRequiredElementById("layer-4").onclick = markEditAndScriptRunBoxesChecked;
}
