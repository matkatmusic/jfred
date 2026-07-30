// One wash primitive: a full-width band over the timeline's [startPx, endPx], tinted `color`.
//
// Sessions, the diff range, and future export/commit range selections all spawn this same shape (user, 2026-07-30).

import { el } from "./app-dom.ts";

export function spawnWash(startPx: number, endPx: number, color: string): HTMLElement {
    const wash = el("div", { class: "wash" });
    wash.style.setProperty("--axis-px", String(startPx));
    wash.style.setProperty("--span-px", String(endPx - startPx));
    wash.style.setProperty("--wash-color", color);
    return wash;
}
