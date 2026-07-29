// The Layer 1 page's orphan-bucket jump buttons (task 256). The two buckets are placed at their EARLIEST member's instant, which on a real project is thousands of pixels down (and across) a canvas that is ~156,000 px wide — so reaching them by scrolling is the reported complaint. These buttons are pure navigation: they change nothing about the render, they only move the scrollport.
//
// Its own module rather than more of layer1-page.ts, which is at 205 of the project's 250-line cap.
//
// ponytail: the whole jump is native `Element.scrollIntoView`, exactly as webapp/layered-app.ts and webapp/app-consent.ts already do it. No measurement, no arithmetic, and — the part that matters here — no zoom compensation: layer1-zoom.ts applies the NATIVE CSS `zoom` property, which participates in layout, so the browser's own scroll positions are already in zoomed pixels. A hand-rolled `scrollTop = element.offsetTop` helper would have needed dividing by `--zoom` and would have been wrong at every level but 100%.

// A bucket is identified by the heading text renderLayer1View writes into its `.fname`. That string is NOT repeated here: each button carries it in `data-bucket` in webapp/layer1.html, right beside the visible label a reader compares against the bucket on screen — one literal per direction, in markup, instead of a second copy in a second module that could silently drift.
const BUCKET_SELECTOR = ".filebox.bucket";
const JUMP_BUTTON_SELECTOR = ".jumpbar [data-bucket]";

// The rendered bucket whose heading is `title`, or undefined when the view has none. Matching on the heading rather than on position is deliberate: renderLayer1View emits the two buckets in a fixed order but DROPS an empty one entirely (buildOrphanBucket returns undefined for zero rows), so "the second bucket" is not reliably the disk-orphan bucket.
function findBucketByTitle(title: string): HTMLElement | undefined {
    for (const bucket of document.querySelectorAll<HTMLElement>(BUCKET_SELECTOR)) {
        if (bucket.querySelector(".fname")?.textContent === title) {
            return bucket;
        }
    }
    return undefined;
}

// Centre a bucket in the scrollport. Absent bucket = silent no-op: both buttons are in the header from page load, but a view with no orphans in one direction renders no bucket for it, and a dead button is a better outcome than a thrown error on click.
export function jumpToBucket(title: string): void {
    findBucketByTitle(title)?.scrollIntoView({ behavior: "smooth", block: "center" });
}

// Wire every jump button in the header. The lookup happens on CLICK, never here: the buckets do not exist yet when bootLayer1Page runs — they arrive ~10 s later when loadLayer1View's stream resolves, and every subsequent Load replaces them with fresh elements.
export function wireBucketJumpButtons(): void {
    for (const button of document.querySelectorAll<HTMLElement>(JUMP_BUTTON_SELECTOR)) {
        button.addEventListener("click", () => jumpToBucket(button.dataset["bucket"] ?? ""));
    }
}
