// ─── routes ──────────────────────────────────────────────────────────────────
export function routeToProject(project) {
    return `#/project/${encodeURIComponent(project)}`;
}
// anchorLine: 0-based raw JSONL line index to scroll to and highlight.
export function routeToConversation(project, jsonl, anchorLine) {
    const base = `${routeToProject(project)}/jsonl/${encodeURIComponent(jsonl)}`;
    return anchorLine === undefined ? base : `${base}/at/${encodeURIComponent(anchorLine)}`;
}
export function routeToFileHistory(project, target) {
    return `${routeToProject(project)}/file/${encodeURIComponent(target)}`;
}
// anchorJsonl (optional): scroll the timeline to that session's first node.
// anchorLine (optional, 0-based raw JSONL line, requires anchorJsonl): scroll to the step owning
// that line and open the JSON inspector on it.
export function routeToTimeline(project, anchorJsonl, anchorLine) {
    const base = `${routeToProject(project)}/timeline`;
    if (anchorJsonl === undefined) {
        return base;
    }
    const sessionRoute = `${base}/session/${encodeURIComponent(anchorJsonl)}`;
    if (anchorLine === undefined) {
        return sessionRoute;
    }
    return `${sessionRoute}/at/${encodeURIComponent(anchorLine)}`;
}
export function parseRouteSegments() {
    return location.hash.replace(/^#\/?/, "").split("/").filter((segment) => segment.length > 0)
        .map(decodeURIComponent);
}
// True when the parsed hash segments carry the revision timeline underneath: EVERY project
// route does (user decision 2026-07-06) — the timeline is a loaded project's base view, and
// jsonl/file sub-routes render as drawers over it.
export function checkRouteIsTimeline(segments) {
    return segments[0] === "project";
}
