// Server instantiation of the session-dots wire shapes: Date instants, Uuid ids.
import type { Instant } from "./layered_types.ts";
import type { Uuid } from "./structures/domain.ts";
import type { WireAnnotationOf, WireSessionDotsOf, WireSessionSpanOf } from "../webapp/layer1-components/session-column/layer1-wire-annotations.ts";

export type Layer1WireAnnotation = WireAnnotationOf<Instant, Uuid>;
export type Layer1WireSessionSpan = WireSessionSpanOf<Instant, Uuid>;
export type Layer1WireSessionDots = WireSessionDotsOf<Instant, Uuid>;

// Every kept dot sorted ascending by instant, and every kept session's span.
export interface SessionDotIndex {
  dots: Layer1WireAnnotation[];
  sessionSpans: Layer1WireSessionSpan[];
}
