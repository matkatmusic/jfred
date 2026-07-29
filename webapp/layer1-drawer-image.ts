// Task 299: the drawer's image pane — fit-first render plus the header's − / fit / + zoom buttons.

import { el, getRequiredElementById } from "./app-dom.ts";

const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "ico"]);
const ZOOM_IN_FACTOR = 1.25;
const ZOOM_OUT_FACTOR = 0.8;

// Files the drawer shows as pictures; other binaries keep the placeholder sentence.
export function isImagePath(path: string): boolean {
    return IMAGE_EXTENSIONS.has(path.split(".").pop()?.toLowerCase() ?? "");
}

// 0 = fit-to-pane (the first-render state); otherwise a multiple of the image's natural size.
let imageScale = 0;

function findDrawerImage(): HTMLImageElement | null {
    return document.getElementById("dimg") as HTMLImageElement | null;
}

function applyImageScale(): void {
    const image = findDrawerImage();
    if (image === null) {
        return;
    }
    image.classList.toggle("fit", imageScale === 0);
    image.style.width = imageScale === 0 ? "" : `${image.naturalWidth * imageScale}px`;
}

function stepImageZoom(factor: number): void {
    const image = findDrawerImage();
    if (image === null) {
        return;
    }
    // Leaving fit starts from the on-screen scale, so the first step continues from what is visible.
    imageScale = (imageScale === 0 ? image.clientWidth / image.naturalWidth || 1 : imageScale) * factor;
    applyImageScale();
}

// Fill the drawer body with the image at `sourceUrl`, zoomed to fit on first render.
export function renderImageInto(host: HTMLElement, sourceUrl: string): void {
    imageScale = 0;
    host.replaceChildren(el("div", { class: "dimgwrap" }, [
        el("img", { id: "dimg", class: "fit", alt: "image file", src: sourceUrl }),
    ]));
}

// Wired once (wireNodeDrawer); the buttons live in the drawer header's #imgtools strip.
export function wireImageZoomTools(): void {
    getRequiredElementById("img-zoom-in").addEventListener("click", () => stepImageZoom(ZOOM_IN_FACTOR));
    getRequiredElementById("img-zoom-out").addEventListener("click", () => stepImageZoom(ZOOM_OUT_FACTOR));
    getRequiredElementById("img-zoom-fit").addEventListener("click", () => {
        imageScale = 0;
        applyImageScale();
    });
}
