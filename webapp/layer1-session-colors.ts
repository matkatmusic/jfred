// One deterministic color per session, in order of first appearance (L9 redesign, test page only).

import type { WireAnnotation } from "./layer1-wire-annotations.ts";

const GOLDEN_ANGLE_DEGREES = 137.5;

export function buildSessionColor(index: number): string {
  const hue = (index * GOLDEN_ANGLE_DEGREES) % 360;
  return `hsl(${hue}, 65%, 60%)`;
}

export function listSessionColors(annotations: readonly WireAnnotation[]): Map<string, string> {
  const colors = new Map<string, string>();
  for (const annotation of annotations) {
    if (!colors.has(annotation.sessionId))
      colors.set(annotation.sessionId, buildSessionColor(colors.size));
  }
  return colors;
}
