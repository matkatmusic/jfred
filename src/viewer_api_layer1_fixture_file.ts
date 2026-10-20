// Fixture-mode file and diff routes, split from viewer_api_layer1_fixture.ts.

import { type ServerResponse } from "node:http";
import { basename } from "node:path";
import { buildLayer1DiffPayload } from "./viewer_api_layer1_diff.ts";
import { contentLines, type FixtureRevisionNode } from "./viewer_api_layer1_fixture_content.ts";
import { findTitleAt } from "./viewer_api_layer1_fixture_data.ts";
import { SNAPSHOTS } from "./viewer_api_layer2_fixture_data.ts";
import { requireParam, sendJson } from "./viewer_server_routes.ts";

function buildFixtureNode(query: URLSearchParams): FixtureRevisionNode {
  const isSnapshotRequest = query.get("snapshotSession") !== null;
  if (isSnapshotRequest) {
    return { kind: "snapshot", version: `@v${requireParam(query, "version")}`,
      session: basename(requireParam(query, "snapshotSession")) };
  }
  const hash = (query.get("hash") ?? "").trim();
  if (hash !== "") {
    return { kind: "commit", hash };
  }
  return { kind: "working tree" };
}

function getFixtureSnapshotTitle(query: URLSearchParams): string {
  const sessionFile = basename(requireParam(query, "snapshotSession"));
  const version = `@v${requireParam(query, "version")}`;
  const path = requireParam(query, "path");
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

export function sendFixtureFile(response: ServerResponse, query: URLSearchParams): void {
  const path = requireParam(query, "path");
  const node = buildFixtureNode(query);
  const content = contentLines(path, node).join("\n");
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
  const path = requireParam(query, "path");
  const hash = (query.get(hashParam) ?? "").trim();
  const node: FixtureRevisionNode = hash !== "" ? { kind: "commit", hash } : { kind: "working tree" };
  return contentLines(path, node);
}

export function sendFixtureDiff(response: ServerResponse, query: URLSearchParams): void {
  const baseLines = getFixtureDiffLines(query, "baseHash");
  const targetLines = getFixtureDiffLines(query, "targetHash");
  sendJson(response, 200, { diff: buildLayer1DiffPayload(baseLines, targetLines, query.get("context") === "full") });
}
