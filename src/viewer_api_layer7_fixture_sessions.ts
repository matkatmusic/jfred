// Canned L7 fixture: session of each log record, between-row records, same-instant pair.

import { Uuid } from "./structures/domain.ts";
import { WireRecordKind, type WireAnnotationOf } from "../webapp/layer1-components/session-column/layer1-wire-annotations.ts";
import type { Layer1WireView } from "./viewer_api_layer1.ts";
import { FIXTURE_JSONL_DIR, buildSessionId } from "./viewer_api_layer1_fixture_data.ts";

type Annotation = WireAnnotationOf<Date, Uuid>;
// The line number is assigned last, once the list is sorted.
export type AnnotationDraft = Omit<Annotation, "line">;
type Ruler = Layer1WireView["ruler"];

export interface FixtureLogSession {
  id: Uuid;
  file: string;
  title: string;
}

// In first-appearance order: this is the color order.
export const FIXTURE_LOG_SESSIONS: FixtureLogSession[] = [
  { id: buildSessionId("0f3c9a7e.jsonl"), file: "0f3c9a7e.jsonl", title: "seed the demo app" },
  { id: buildSessionId("b21d84c5.jsonl"), file: "b21d84c5.jsonl", title: "extract the trim helper" },
  { id: buildSessionId("7ce50a19.jsonl"), file: "7ce50a19.jsonl", title: "session3" },
  { id: buildSessionId("d4a06b8f.jsonl"), file: "d4a06b8f.jsonl", title: "cover the error branch, take notes" },
];

// One digit per filler (index 0 to 59): the number of its session in FIXTURE_LOG_SESSIONS.
const FILLER_SESSION_DIGITS = ["1112213213", "2323232323233", "2222222", "4".repeat(30)].join("");
const MID_FILLER_REMAINDER = 2;
const MID_FILLER_STEP = 5;
const SAME_INSTANT_FILLER_INDEX = 7;

export const ANNOTATION_SAME_ID = new Uuid("l7-same-0");

function listMidIds(): Uuid[] {
  const ids: Uuid[] = [];
  for (let index = 0; index < FILLER_SESSION_DIGITS.length; index += 1) {
    const isMidFiller = index % MID_FILLER_STEP === MID_FILLER_REMAINDER;
    if (isMidFiller) {
      ids.push(new Uuid(`l7-mid-${String(index).padStart(2, "0")}`));
    }
  }
  return ids;
}

export const ANNOTATION_MID_IDS: Uuid[] = listMidIds();

export function readBlockSession(): FixtureLogSession {
  return FIXTURE_LOG_SESSIONS[0]!;
}

export function readFillerSession(index: number): FixtureLogSession {
  return FIXTURE_LOG_SESSIONS[Number(FILLER_SESSION_DIGITS[index]) - 1]!;
}

export function readSessionFields(session: FixtureLogSession): Pick<Annotation, "sessionId" | "sessionTitle" | "sessionFile"> {
  return { sessionId: session.id, sessionTitle: session.title, sessionFile: `${FIXTURE_JSONL_DIR}/${session.file}` };
}

function findNextTickInstant(ruler: Ruler, instant: Date): Date {
  for (let tick = 0; tick < ruler.length - 1; tick += 1) {
    const isFillerTick = ruler[tick]!.instant.getTime() === instant.getTime();
    if (isFillerTick) {
      return ruler[tick + 1]!.instant;
    }
  }
  throw new Error(`no ruler tick follows ${instant.toISOString()}`);
}

function buildMidAnnotation(filler: AnnotationDraft, index: number, midNumber: number, ruler: Ruler): AnnotationDraft {
  const nextMs = findNextTickInstant(ruler, filler.instant).getTime();
  return {
    id: ANNOTATION_MID_IDS[midNumber]!,
    kind: WireRecordKind.toolUse,
    instant: new Date(Math.floor((filler.instant.getTime() + nextMs) / 2)),
    label: `Read: file ${index}`,
    sessionId: filler.sessionId,
    sessionTitle: filler.sessionTitle,
    sessionFile: filler.sessionFile,
  };
}

// One tool-use record halfway between each chosen filler's tick and the next tick.
export function listMidAnnotations(fillers: AnnotationDraft[], ruler: Ruler): AnnotationDraft[] {
  const mids: AnnotationDraft[] = [];
  for (const [index, filler] of fillers.entries()) {
    const isMidFiller = index % MID_FILLER_STEP === MID_FILLER_REMAINDER;
    if (isMidFiller) {
      mids.push(buildMidAnnotation(filler, index, mids.length, ruler));
    }
  }
  return mids;
}

function listAnnotatedInstants(annotations: AnnotationDraft[]): Set<number> {
  const instants = new Set<number>();
  for (const annotation of annotations) {
    instants.add(annotation.instant.getTime());
  }
  return instants;
}

function countAnnotationsBefore(sorted: AnnotationDraft[], startCount: number, instantMs: number): number {
  let count = startCount;
  while (count < sorted.length) {
    const isBeforeInstant = sorted[count]!.instant.getTime() < instantMs;
    if (!isBeforeInstant) {
      break;
    }
    count += 1;
  }
  return count;
}

// No earlier annotation means the first session.
function buildRowAnnotation(rowNumber: number, instant: Date, earlier: AnnotationDraft | undefined): AnnotationDraft {
  const sessionFields = earlier === undefined ? readSessionFields(readBlockSession()) : earlier;
  return {
    id: new Uuid(`l7-row-${String(rowNumber).padStart(3, "0")}`),
    kind: WireRecordKind.assistant,
    instant,
    label: "Made-up chat line",
    sessionId: sessionFields.sessionId,
    sessionTitle: sessionFields.sessionTitle,
    sessionFile: sessionFields.sessionFile,
  };
}

// One record per unannotated ruler row, in the session of the nearest earlier record.
export function listRowAnnotations(sorted: AnnotationDraft[], ruler: Ruler): AnnotationDraft[] {
  const annotatedMs = listAnnotatedInstants(sorted);
  const rows: AnnotationDraft[] = [];
  let earlierCount = 0;
  for (const [rowNumber, tick] of ruler.entries()) {
    earlierCount = countAnnotationsBefore(sorted, earlierCount, tick.instant.getTime());
    const hasAnnotation = annotatedMs.has(tick.instant.getTime());
    if (!hasAnnotation) {
      rows.push(buildRowAnnotation(rowNumber, tick.instant, sorted[earlierCount - 1]));
    }
  }
  return rows;
}

// Same instant as filler 7 (session 2), but in session 3.
export function buildSameInstantAnnotation(fillers: AnnotationDraft[]): AnnotationDraft {
  const session = FIXTURE_LOG_SESSIONS[2]!;
  return {
    id: ANNOTATION_SAME_ID,
    kind: WireRecordKind.assistant,
    instant: fillers[SAME_INSTANT_FILLER_INDEX]!.instant,
    label: "same time as S2",
    ...readSessionFields(session),
  };
}
