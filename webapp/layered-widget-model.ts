// Layered file-widget models and ruler maths (task 207, spec S8), built from the wire graph.

// Wire form of a layered graph node: Path/Uuid arrive as strings, instants as ISO text.
export interface WireTimelineNode {
  kind: string;
  instant: string;
}

export interface WireSessionTimeline {
  sessionFile: string;
  // Engine-sorted onto the axis, so the first node is the session's earliest instant.
  timeline: { nodes: WireTimelineNode[] };
}

export interface WireEntity {
  filename: string;
  sessionTimelines: WireSessionTimeline[];
  // Server-derived instants where two distinct sessions observed the same bytes.
  corroboratedInstants: string[];
}

// Server-resolved ruler offset per ISO instant: the S18 gap cap accumulates, so the page only looks it up.
export type AxisOffsetsPx = Record<string, number>;

export interface WireLayeredGraph {
  entities: WireEntity[];
  axisOffsetsPx: AxisOffsetsPx;
}

// One file's canvas widget: per-session lanes plus the instant its history starts at.
export interface FileWidgetModel {
  fileName: string;
  lanes: WireSessionTimeline[];
  // Undefined for a file with no dated evidence: its widget pins to the axis origin.
  startInstant: Date | undefined;
  corroboratedInstants: Date[];
}

// The last path segment of a "/"-joined wire path.
export function extractBasename(wirePath: string): string {
  return wirePath.split("/").pop() ?? wirePath;
}

// The distinct sessionFile basenames across the graph, in first-seen order.
export function listSessionBasenames(graph: WireLayeredGraph): string[] {
  const seen = new Set<string>();
  for (const entity of graph.entities) {
    for (const sessionTimeline of entity.sessionTimelines) {
      seen.add(extractBasename(sessionTimeline.sessionFile));
    }
  }
  return [...seen];
}

// Every instant a file's lanes carry, hydrated from the wire's ISO text.
export function listLaneInstants(lanes: WireSessionTimeline[]): Date[] {
  const instants: Date[] = [];
  for (const lane of lanes) {
    for (const node of lane.timeline.nodes) {
      instants.push(new Date(node.instant));
    }
  }
  return instants;
}

// The earliest instant, or the latest when `keepLater` is true; undefined when there are none.
export function findExtremeInstant(instants: Date[], keepLater: boolean): Date | undefined {
  let kept: Date | undefined;
  for (const instant of instants) {
    if (kept === undefined) {
      kept = instant;
      continue;
    }
    if ((instant > kept) === keepLater) {
      kept = instant;
    }
  }
  return kept;
}

// Where one instant sits on the shared ruler; an unresolved instant reads as the origin.
function getAxisPx(instant: Date, offsets: AxisOffsetsPx): number {
  return offsets[instant.toISOString()] ?? 0;
}

// Pixels from `origin` to `instant` on the ruler; a missing end pins to origin.
export function measureAxisOffsetPx(instant: Date | undefined, origin: Date | undefined, offsets: AxisOffsetsPx): number {
  if (instant === undefined) {
    return 0;
  }
  if (origin === undefined) {
    return 0;
  }
  return getAxisPx(instant, offsets) - getAxisPx(origin, offsets);
}

// Sort key for widget order: history start, with undated files last.
function getStartSortKey(model: FileWidgetModel): number {
  return model.startInstant?.getTime() ?? Number.POSITIVE_INFINITY;
}

function compareWidgetStarts(a: FileWidgetModel, b: FileWidgetModel): number {
  return getStartSortKey(a) - getStartSortKey(b);
}

// The widget models for a fetched graph, ordered by history start (the S8 widget order).
export function buildFileWidgetModels(graph: WireLayeredGraph): FileWidgetModel[] {
  const models: FileWidgetModel[] = [];
  for (const entity of graph.entities) {
    const corroboratedInstants: Date[] = [];
    for (const instant of entity.corroboratedInstants) {
      corroboratedInstants.push(new Date(instant));
    }
    models.push({
      fileName: entity.filename,
      lanes: entity.sessionTimelines,
      startInstant: findExtremeInstant(listLaneInstants(entity.sessionTimelines), false),
      corroboratedInstants,
    });
  }
  return models.sort(compareWidgetStarts);
}
