// Task 356: one dashed line per script run that has dots in 2+ bubbles; a click on it opens the shared drawer.

import { createElement } from "./app-dom.ts";

interface DotCentre {
  xPx: number;
  yPx: number;
}

// ponytail: offsetLeft/offsetTop are layout values, unscaled by the canvas `zoom`, and ignore the dot's translate, so a dot's offset IS its centre. Hidden dots (visibility) still lay out.
function measureDotCentre(dot: HTMLElement, stage: HTMLElement): DotCentre {
  let xPx = 0;
  let yPx = 0;
  let owner: HTMLElement | null = dot;
  while (owner !== null && owner !== stage) {
    xPx += owner.offsetLeft;
    yPx += owner.offsetTop;
    owner = owner.offsetParent as HTMLElement | null;
  }
  if (owner === null) {
    throw new Error("a script-run dot is not inside the positioned stage");
  }
  return { xPx, yPx };
}

function groupDotsByToolUseId(stage: HTMLElement): Map<string, HTMLElement[]> {
  const groups = new Map<string, HTMLElement[]>();
  for (const dot of stage.querySelectorAll<HTMLElement>("i.n-script")) {
    const toolUseId = dot.dataset["toolUseId"]!;
    groups.set(toolUseId, [...(groups.get(toolUseId) ?? []), dot]);
  }
  return groups;
}

export function drawScriptConnectors(stage: HTMLElement): void {
  for (const [toolUseId, dots] of groupDotsByToolUseId(stage)) {
    if (dots.length < 2) {
      continue;
    }
    const centres = dots.map((dot) => measureDotCentre(dot, stage));
    const leftPx = Math.min(...centres.map((centre) => centre.xPx));
    const rightPx = Math.max(...centres.map((centre) => centre.xPx));
    const connector = createElement("div", { class: "script-connector", "data-tool-use-id": toolUseId });
    connector.style.left = `${leftPx}px`;
    connector.style.top = `${centres[0]!.yPx}px`;
    connector.style.width = `${rightPx - leftPx}px`;
    stage.append(connector);
  }
}
