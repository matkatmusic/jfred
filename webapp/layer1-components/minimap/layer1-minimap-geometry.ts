// Minimap geometry (split from layer1-minimap.ts): content-space boxes, the per-axis scale, and plot placement.

// A scaled bubble shrinks below a pixel; 1.5 px keeps every widget visible.
const MINIMUM_MARK_PX = 1.5;

// A box in CONTENT coordinates, from the same origin scrollLeft/scrollTop count from.
export interface ContentBoxPx {
  leftPx: number;
  topPx: number;
  widthPx: number;
  heightPx: number;
}

// Plot px per content px, PER AXIS: a uniform scale squashed every mark into the plot's top fifth.
export interface MinimapScale {
  xPerContentPx: number;
  yPerContentPx: number;
}

// Math.max guards a divide-by-zero pre-render, or under happy-dom's zero layout.
export function computeMinimapScale(
  contentWidthPx: number,
  contentHeightPx: number,
  plotWidthPx: number,
  plotHeightPx: number,
): MinimapScale {
  return {
    xPerContentPx: plotWidthPx / Math.max(contentWidthPx, 1),
    yPerContentPx: plotHeightPx / Math.max(contentHeightPx, 1),
  };
}

// Place one rectangle inside the plot, for both a widget mark and the viewport rectangle.
export function applyBoxToPlot(target: HTMLElement, box: ContentBoxPx, scale: MinimapScale): void {
  target.style.left = `${box.leftPx * scale.xPerContentPx}px`;
  target.style.top = `${box.topPx * scale.yPerContentPx}px`;
  target.style.width = `${Math.max(box.widthPx * scale.xPerContentPx, MINIMUM_MARK_PX)}px`;
  target.style.height = `${Math.max(box.heightPx * scale.yPerContentPx, MINIMUM_MARK_PX)}px`;
}

// One widget's content-space box; `paneRect` is passed in because the pane's box never moves between widgets.
export function measureInContent(widget: Element, pane: HTMLElement, paneRect: DOMRect): ContentBoxPx {
  const rect = widget.getBoundingClientRect();
  return {
    leftPx: rect.left - paneRect.left + pane.scrollLeft,
    topPx: rect.top - paneRect.top + pane.scrollTop,
    widthPx: rect.width,
    heightPx: rect.height,
  };
}
