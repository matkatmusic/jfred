// ─── routes ──────────────────────────────────────────────────────────────────

export function getProjectRoute(project: string): string {
  return `#/project/${encodeURIComponent(project)}`;
}
// anchorLine: 0-based raw JSONL line index to scroll to and highlight.
export function getConversationRoute(project: string, jsonl: string, anchorLine?: string | number): string {
  const base = `${getProjectRoute(project)}/jsonl/${encodeURIComponent(jsonl)}`;
  return anchorLine === undefined ? base : `${base}/at/${encodeURIComponent(anchorLine)}`;
}
export function getFileHistoryRoute(project: string, target: string): string {
  return `${getProjectRoute(project)}/file/${encodeURIComponent(target)}`;
}
// anchorJsonl scrolls to that session's first node; anchorLine (needs anchorJsonl) opens the inspector on that line.
export function getTimelineRoute(project: string, anchorJsonl?: string, anchorLine?: string | number): string {
  const base = `${getProjectRoute(project)}/timeline`;
  if (anchorJsonl === undefined) {
    return base;
  }
  const sessionRoute = `${base}/session/${encodeURIComponent(anchorJsonl)}`;
  if (anchorLine === undefined) {
    return sessionRoute;
  }
  return `${sessionRoute}/at/${encodeURIComponent(anchorLine)}`;
}

export function parseRouteSegments(): string[] {
  const hashPath = location.hash.replace(/^#\/?/, "");
  const rawSegments = hashPath.split("/");
  const segments: string[] = [];
  for (const rawSegment of rawSegments) {
    if (rawSegment.length > 0) {
      segments.push(decodeURIComponent(rawSegment));
    }
  }
  return segments;
}

// True for every project route: the timeline is the base view and jsonl/file routes are drawers over it.
export function isTimelineRoute(segments: string[]): boolean {
  return segments[0] === "project";
}
