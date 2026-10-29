// Fixture-mode file and diff routes, split from viewer_api_layer1_fixture.ts.

import { type ServerResponse } from "node:http";
import { basename } from "node:path";
import { buildLayer1DiffPayload } from "./viewer_api_layer1_diff.ts";
import { listContentLines, type FixtureRevisionNode } from "./viewer_api_layer1_fixture_content.ts";
import { findTitleAt } from "./viewer_api_layer1_fixture_data.ts";
import { SNAPSHOTS } from "./viewer_api_layer2_fixture_data.ts";
import { EDITS } from "./viewer_api_layer3_fixture_data.ts";
import { buildFixtureRecord, readFixtureEditFile } from "./viewer_api_layer3_fixture_replay.ts";
import { readFixtureBranchFile } from "./viewer_api_layer5_mockup_branches.ts";
import { SCRIPT_RUN_NODE_KIND } from "./viewer_api_layer4_fixture_data.ts";
import { getRequiredParam, sendJson } from "./viewer_server_routes.ts";

function buildFixtureNode(query: URLSearchParams): FixtureRevisionNode {
  const scriptRunId = query.get("scriptRun");
  if (scriptRunId !== null) {
    return { kind: SCRIPT_RUN_NODE_KIND, toolUseId: scriptRunId };
  }
  const isSnapshotRequest = query.get("snapshotSession") !== null;
  if (isSnapshotRequest) {
    return { kind: "snapshot", version: `@v${getRequiredParam(query, "version")}`,
      session: basename(getRequiredParam(query, "snapshotSession")) };
  }
  const hash = (query.get("hash") ?? "").trim();
  if (hash !== "") {
    return { kind: "commit", hash };
  }
  return { kind: "working tree" };
}

function getFixtureSnapshotTitle(query: URLSearchParams): string {
  const sessionFile = basename(getRequiredParam(query, "snapshotSession"));
  const version = `@v${getRequiredParam(query, "version")}`;
  const path = getRequiredParam(query, "path");
  let line = 0;
  for (const entry of SNAPSHOTS) {
    const isTarget = entry.path === path && entry.session === sessionFile && entry.version === version;
    if (isTarget) {
      line = entry.line;
      break;
    }
  }
  return findTitleAt(sessionFile, line);
}

// The fixture's stand-in for a transcript line: the edit event recorded at that session and line.
export function sendFixtureRecord(response: ServerResponse, query: URLSearchParams): void {
  const session = basename(getRequiredParam(query, "jsonl"));
  const line = Number(getRequiredParam(query, "line"));
  const event = EDITS.find((entry) => entry.session === session && entry.line === line);
  if (event === undefined) {
    throw new Error(`no fixture record at line ${line} of ${session}`);
  }
  sendJson(response, 200, buildFixtureRecord(event));
}

export function sendFixtureFile(response: ServerResponse, query: URLSearchParams): void {
  const editChangeId = query.get("editChangeId");
  if (editChangeId !== null) {
    const isBranchRequest = query.get("branch") === "1";
    if (isBranchRequest) {
      sendJson(response, 200, readFixtureBranchFile(getRequiredParam(query, "path"), editChangeId, getRequiredParam(query, "side")));
      return;
    }
    sendJson(response, 200, readFixtureEditFile(editChangeId, getRequiredParam(query, "side")));
    return;
  }
  const path = getRequiredParam(query, "path");
  const node = buildFixtureNode(query);
  const content = listContentLines(path, node).join("\n");
  const isBinary = query.get("binary") === "1";
  if (isBinary) {
    response.writeHead(200, { "Content-Type": "application/octet-stream" });
    response.end(Buffer.from(content));
    return;
  }
  if (node.kind === "snapshot") {
    sendJson(response, 200, { content, title: getFixtureSnapshotTitle(query) });
    return;
  }
  sendJson(response, 200, { content });
}

function getFixtureDiffLines(query: URLSearchParams, hashParam: string): string[] {
  const path = getRequiredParam(query, "path");
  const hash = (query.get(hashParam) ?? "").trim();
  const node: FixtureRevisionNode = hash !== "" ? { kind: "commit", hash } : { kind: "working tree" };
  return listContentLines(path, node);
}

export function sendFixtureDiff(response: ServerResponse, query: URLSearchParams): void {
  const baseLines = getFixtureDiffLines(query, "baseHash");
  const targetLines = getFixtureDiffLines(query, "targetHash");
  sendJson(response, 200, { diff: buildLayer1DiffPayload(baseLines, targetLines, query.get("context") === "full") });
}
