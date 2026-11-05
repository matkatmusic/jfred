// Fixture-mode stand-ins for transcript lines: the record at a session file name and a 1-based line.

import { basename } from "node:path";
import { buildSessionId } from "./viewer_api_layer1_fixture_data.ts";
import { buildFixtureLayer1View } from "./viewer_api_layer1_fixture_view.ts";
import { SNAPSHOTS } from "./viewer_api_layer2_fixture_data.ts";
import { EDITS } from "./viewer_api_layer3_fixture_data.ts";
import { buildFixtureRecord } from "./viewer_api_layer3_fixture_replay.ts";
import { SCRIPT_RUNS } from "./viewer_api_layer4_fixture_data.ts";

type Annotation = NonNullable<ReturnType<typeof buildFixtureLayer1View>["annotations"]>[number];

function findSnapshotRecord(session: string, line: number): object | undefined {
  for (const snapshot of SNAPSHOTS) {
    const isSameSession = snapshot.session === session;
    const isSameLine = snapshot.line === line;
    const isMatch = isSameSession && isSameLine;
    if (isMatch) {
      const backups = { [snapshot.path]: { version: Number(snapshot.version.replace("@v", "")), backupTime: snapshot.at } };
      return { type: "file-history-snapshot", sessionId: buildSessionId(session).toString(), snapshot: { trackedFileBackups: backups } };
    }
  }
  return undefined;
}

function findScriptRunRecord(session: string, line: number): object | undefined {
  for (const run of SCRIPT_RUNS) {
    const isSameSession = run.session === session;
    const isSameLine = run.line === line;
    const isMatch = isSameSession && isSameLine;
    if (isMatch) {
      const toolUse = { type: "tool_use", id: run.toolUseId, name: "Bash", input: { command: run.code.join("\n") } };
      return { type: "assistant", sessionId: buildSessionId(session).toString(), message: { content: [toolUse] } };
    }
  }
  return undefined;
}

function buildAnnotationRecord(annotation: Annotation): object {
  return {
    type: annotation.kind,
    uuid: annotation.id.toString(),
    timestamp: annotation.instant.toISOString(),
    sessionId: annotation.sessionId.toString(),
    message: { content: annotation.label },
  };
}

function findAnnotationRecord(session: string, line: number): object | undefined {
  for (const annotation of buildFixtureLayer1View().annotations ?? []) {
    const isSameSession = basename(annotation.sessionFile) === session;
    const isSameLine = annotation.line === line;
    const isMatch = isSameSession && isSameLine;
    if (isMatch) {
      return buildAnnotationRecord(annotation);
    }
  }
  return undefined;
}

function findEditRecord(session: string, line: number): object | undefined {
  for (const event of EDITS) {
    const isSameSession = event.session === session;
    const isSameLine = event.line === line;
    const isMatch = isSameSession && isSameLine;
    if (isMatch) {
      return buildFixtureRecord(event);
    }
  }
  return undefined;
}

export function findFixtureLineRecord(session: string, line: number): object | undefined {
  return findEditRecord(session, line) ?? findSnapshotRecord(session, line) ?? findScriptRunRecord(session, line) ?? findAnnotationRecord(session, line);
}
