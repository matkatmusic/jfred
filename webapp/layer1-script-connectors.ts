// Task 356: one dashed line per script run that has dots in 2+ bubbles.

import { createElement } from "./app-dom.ts";

interface DotCentre {
  xPx: number;
  yPx: number;
}

// Layout offsets ignore canvas zoom and the dot's translate, so a dot's offset is its centre.
function measureDotCentre(dot: HTMLElement, stage: HTMLElement): DotCentre {
  let xPx = 0;
  let yPx = 0;
  let owner: HTMLElement | null = dot;
  while (owner !== stage) {
    if (owner === null) {
      throw new Error("a script-run dot is not inside the positioned stage");
    }
    xPx += owner.offsetLeft;
    yPx += owner.offsetTop;
    owner = owner.offsetParent as HTMLElement | null;
  }
  return { xPx, yPx };
}

function collectDotsByToolUseId(stage: HTMLElement): Map<string, HTMLElement[]> {
  const groups = new Map<string, HTMLElement[]>();
  for (const dot of stage.querySelectorAll<HTMLElement>("i.n-script")) {
    const toolUseId = dot.dataset["toolUseId"]!;
    groups.set(toolUseId, [...(groups.get(toolUseId) ?? []), dot]);
  }
  return groups;
}

export function renderScriptConnectors(stage: HTMLElement): void {
  for (const [toolUseId, dots] of collectDotsByToolUseId(stage)) {
    if (dots.length < 2) {
      continue;
    }
    const centres: DotCentre[] = [];
    let leftPx = Infinity;
    let rightPx = -Infinity;
    for (const dot of dots) {
      const centre = measureDotCentre(dot, stage);
      centres.push(centre);
      leftPx = Math.min(leftPx, centre.xPx);
      rightPx = Math.max(rightPx, centre.xPx);
    }
    const connector = createElement("div", { class: "script-connector", "data-tool-use-id": toolUseId });
    connector.style.left = `${leftPx}px`;
    connector.style.top = `${centres[0]!.yPx}px`;
    connector.style.width = `${rightPx - leftPx}px`;
    stage.append(connector);
  }
}
