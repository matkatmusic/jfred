// Fixture mode: the canned /api/layer1-sessions payload.

import { type WireSession } from "../webapp/layer1-wire.ts";
import { FIXTURE_DIR, SESSIONS, buildSessionFile, parseMs } from "./viewer_api_layer1_fixture_data.ts";

function compareSessionsByStart(left: WireSession, right: WireSession): number {
  return left.started.localeCompare(right.started);
}

function buildFixtureSessions(): WireSession[] {
  const sessions: WireSession[] = [];
  for (const session of SESSIONS) {
    // Real transcripts record ABSOLUTE paths; the pane relativizes against the project folder.
    const paths: string[] = [];
    for (const path of session.paths) {
      paths.push(`${FIXTURE_DIR}/${path}`);
    }
    const titles: string[] = [];
    for (const range of session.titles) {
      titles.push(range.title);
    }
    sessions.push({
      file: session.file,
      fullPath: buildSessionFile(session.file).toString(),
      titles,
      started: new Date(parseMs(session.started)).toISOString(),
      ended: new Date(parseMs(session.ended)).toISOString(),
      paths,
    });
  }
  return sessions.sort(compareSessionsByStart);
}

export function buildFixtureSessionsPayload(): { sessions: WireSession[] } {
  return { sessions: buildFixtureSessions() };
}
