// The Layer 1/2 switcher (task 314): a client-side show/hide, never a refetch (task 312 always ships snapshots).
//
// Publishes the layer as `data-layer` on `.viz-root`; CSS hides task 315's `.snap` elements below layer 2.

const DEFAULT_LAYER = "1";

function vizRoot(): HTMLElement {
    return document.querySelector(".viz-root") as HTMLElement;
}

function layerButtons(): HTMLElement[] {
    return [...document.querySelectorAll<HTMLElement>(".layerbar button[data-layer]")];
}

// Publish the layer onto .viz-root and move `.current` to the chosen button. `buttons` is passed in so a click and the boot sync share one list rather than re-querying.
function selectLayer(layer: string, buttons: HTMLElement[]): void {
    vizRoot().dataset.layer = layer;
    for (const button of buttons) {
        button.classList.toggle("current", button.dataset.layer === layer);
    }
}

// Wire both buttons and sync `.current` to whatever the markup opened on, so boot needs one call and not two. No callback: the toggle is pure CSS, so nothing re-loads or re-renders.
export function wireLayerToggle(): void {
    const buttons = layerButtons();
    for (const button of buttons) {
        button.addEventListener("click", () => selectLayer(button.dataset.layer ?? DEFAULT_LAYER, buttons));
    }
    const opening = buttons.find((button) => button.classList.contains("current")) ?? buttons[0];
    selectLayer(opening?.dataset.layer ?? DEFAULT_LAYER, buttons);
}
