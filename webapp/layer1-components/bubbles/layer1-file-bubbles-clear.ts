// Bubble redraws empty the container but keep the details pane, which lives inside it.

const DETAILS_PANE_ID = "detailsPaneContainer";

export function clearFileBubbles(container: HTMLElement): void {
    const detailsPane = document.getElementById(DETAILS_PANE_ID);
    for (const child of Array.from(container.childNodes)) {
        if (child !== detailsPane) {
            child.remove();
        }
    }
}
