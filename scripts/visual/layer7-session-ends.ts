// The first and last record of one fixture session, found from the fixture data.

import { type Uuid } from "../../src/structures/domain.ts";
import { listFixtureAnnotations } from "./layer7-facts.ts";

// Records are in time order, so the ends are the first and last match.
export function findSessionEndIds(sessionId: Uuid): { firstId: string; lastId: string } {
  const recordIds: string[] = [];
  for (const annotation of listFixtureAnnotations()) {
    const isInSession = annotation.sessionId.toString() === sessionId.toString();
    if (isInSession)
      recordIds.push(annotation.id.toString());
  }
  return { firstId: recordIds[0]!, lastId: recordIds[recordIds.length - 1]! };
}
