// The Layer 1 page's orphan-bucket jump buttons (task 256): pure navigation that only moves the scrollport.
// ponytail: native `Element.scrollIntoView` needs no zoom compensation, because CSS `zoom` already scales scroll positions.

// A bucket is identified by its `.fname` heading; each button carries that text in `data-bucket` in layer1.html.
const BUCKET_SELECTOR = ".filebox.bucket";
const JUMP_BUTTON_SELECTOR = ".jumpbar [data-bucket]";

// The rendered bucket titled `title`, or undefined; match by heading because empty buckets are dropped.
function findBucketByTitle(title: string): HTMLElement | undefined {
  for (const bucket of document.querySelectorAll<HTMLElement>(BUCKET_SELECTOR)) {
    const isTitled = bucket.querySelector(".fname")?.textContent === title;
    if (isTitled) {
      return bucket;
    }
  }
  return undefined;
}

// Centre a bucket in the scrollport; an absent bucket is a no-op.
export function moveToBucket(title: string): void {
  findBucketByTitle(title)?.scrollIntoView({ behavior: "smooth", block: "center" });
}

// Attach every jump button in the header; look up the bucket on CLICK, because each Load replaces buckets.
export function attachBucketJumpButtons(): void {
  for (const button of document.querySelectorAll<HTMLElement>(JUMP_BUTTON_SELECTOR)) {
    const bucketTitle = button.dataset["bucket"] ?? "";
    const moveToClickedBucket = (): void => moveToBucket(bucketTitle);
    button.addEventListener("click", moveToClickedBucket);
  }
}
