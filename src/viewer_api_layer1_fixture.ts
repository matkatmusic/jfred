// Task 330: fixture mode — the eight Layer 1 routes served from canned payloads, OFF by default.
//
// /api/pick-folder stays LIVE in fixture mode: an OS dialog only changes inputs these routes ignore.

import { type IncomingMessage, type ServerResponse } from "node:http";
import { basename } from "node:path";
import { type Layer1RefsView, type RepoCommitRow, SourceKind, type WireSession } from "../webapp/layer1-wire.ts";
import { buildLayer1DiffPayload } from "./viewer_api_layer1_diff.ts";
import { contentLines, type FixtureRevisionNode } from "./viewer_api_layer1_fixture_content.ts";
import { buildFixtureLayer1View } from "./viewer_api_layer1_fixture_view.ts";
import {
    BRANCHES, COMMITS, FIXTURE_DIR, FIXTURE_JSONL_DIR, FIXTURE_REPO, SESSIONS, SNAPSHOTS,
    ms, sessionFileFor, titleAt,
} from "./viewer_api_layer1_fixture_data.ts";
import type { Layer1ProjectSettings, Layer1Settings } from "./viewer_api_layer1_settings.ts";
import { streamNdjsonBuild } from "./viewer_api_layer1_route.ts";
import { requireParam, sendJson } from "./viewer_server_routes.ts";

let fixtureModeOn = false;
export function enableFixtureMode(): void { fixtureModeOn = true; }
export function isFixtureMode(): boolean { return fixtureModeOn; }

// ---- the eight canned routes ----

function handleFixtureViewRequest(response: ServerResponse, query: URLSearchParams): void {
    if (query.get("progress") !== "1") {
        sendJson(response, 200, buildFixtureLayer1View());
        return;
    }
    streamNdjsonBuild(response, () => buildFixtureLayer1View());
}

function handleFixtureRefsRequest(response: ServerResponse): void {
    const commits: RepoCommitRow[] = [...COMMITS]
        .sort((left, right) => ms(right.at) - ms(left.at))
        .map((commit) => ({ hash: commit.hash, date: commit.at.slice(0, 10), subject: commit.subject }));
    const refs: Layer1RefsView = { branches: BRANCHES, head: BRANCHES[0]!, commits };
    sendJson(response, 200, refs);
}

function buildFixtureSessions(): WireSession[] {
    return SESSIONS.map((session) => ({
        file: session.file,
        fullPath: sessionFileFor(session.file).toString(),
        title: session.titles[0]?.title ?? "",
        started: new Date(ms(session.started)).toISOString(),
        ended: new Date(ms(session.ended)).toISOString(),
        // Real transcripts record ABSOLUTE paths; the pane relativizes against the project folder.
        paths: session.paths.map((path) => `${FIXTURE_DIR}/${path}`),
    })).sort((left, right) => left.started.localeCompare(right.started));
}

function handleFixtureSessionsRequest(response: ServerResponse, query: URLSearchParams): void {
    if (query.get("progress") !== "1") {
        sendJson(response, 200, { sessions: buildFixtureSessions() });
        return;
    }
    streamNdjsonBuild(response, () => ({ sessions: buildFixtureSessions() }));
}

function isFixtureSnapshotRequest(query: URLSearchParams): boolean {
    return query.get("snapshotSession") !== null;
}

function fixtureNodeFor(query: URLSearchParams): FixtureRevisionNode {
    if (isFixtureSnapshotRequest(query)) {
        return { kind: "snapshot", version: `@v${requireParam(query, "version")}`,
            session: basename(requireParam(query, "snapshotSession")) };
    }
    const hash = query.get("hash");
    if (hash !== null && hash.trim() !== "") {
        return { kind: "commit", hash: hash.trim() };
    }
    return { kind: "working tree" };
}

function fixtureSnapshotTitle(query: URLSearchParams): string {
    const sessionFile = basename(requireParam(query, "snapshotSession"));
    const version = `@v${requireParam(query, "version")}`;
    const path = requireParam(query, "path");
    const snapshot = SNAPSHOTS.find((entry) =>
        entry.path === path && entry.session === sessionFile && entry.version === version);
    return titleAt(sessionFile, snapshot?.line ?? 0);
}

function handleFixtureFileRequest(response: ServerResponse, query: URLSearchParams): void {
    const path = requireParam(query, "path");
    const node = fixtureNodeFor(query);
    const content = contentLines(path, node).join("\n");
    if (query.get("binary") === "1") {
        response.writeHead(200, { "Content-Type": "application/octet-stream" });
        response.end(Buffer.from(content));
        return;
    }
    if (node.kind === "snapshot") {
        sendJson(response, 200, { content, title: fixtureSnapshotTitle(query) });
        return;
    }
    sendJson(response, 200, { content });
}

function fixtureDiffLines(query: URLSearchParams, hashParam: string): string[] {
    const path = requireParam(query, "path");
    const hash = query.get(hashParam);
    const node: FixtureRevisionNode = hash !== null && hash.trim() !== ""
        ? { kind: "commit", hash: hash.trim() } : { kind: "working tree" };
    return contentLines(path, node);
}

function handleFixtureDiffRequest(response: ServerResponse, query: URLSearchParams): void {
    const baseLines = fixtureDiffLines(query, "baseHash");
    const targetLines = fixtureDiffLines(query, "targetHash");
    sendJson(response, 200, { diff: buildLayer1DiffPayload(baseLines, targetLines, query.get("context") === "full") });
}

function fixtureSettings(): Layer1Settings & { defaults: Record<string, never> } {
    const project: Layer1ProjectSettings = {
        dir: FIXTURE_DIR, repo: FIXTURE_REPO, branch: BRANCHES[0]!, ref: BRANCHES[0]!,
        jsonl: [FIXTURE_JSONL_DIR], fileHistory: [],
    };
    return { lastDir: FIXTURE_DIR, projects: { [FIXTURE_DIR]: project }, defaults: {} };
}

function handleFixtureSettingsUpdate(request: IncomingMessage, response: ServerResponse): void {
    request.on("data", () => {});
    request.on("end", () => sendJson(response, 200, { saved: true }));
}

function handleFixtureScanSourceRequest(response: ServerResponse, query: URLSearchParams): void {
    const kind = requireParam(query, "kind");
    const found = kind === SourceKind.jsonl ? SESSIONS.length : SNAPSHOTS.length;
    sendJson(response, 200, { found });
}

export function dispatchLayer1FixtureRoute(request: IncomingMessage, response: ServerResponse, url: URL): boolean {
    if (request.method === "POST" && url.pathname === "/api/layer1-settings") {
        handleFixtureSettingsUpdate(request, response);
    } else if (url.pathname === "/api/layer1-settings") {
        sendJson(response, 200, fixtureSettings());
    } else if (url.pathname === "/api/layer1-view") {
        handleFixtureViewRequest(response, url.searchParams);
    } else if (url.pathname === "/api/layer1-refs") {
        handleFixtureRefsRequest(response);
    } else if (url.pathname === "/api/layer1-sessions") {
        handleFixtureSessionsRequest(response, url.searchParams);
    } else if (url.pathname === "/api/layer1-file") {
        handleFixtureFileRequest(response, url.searchParams);
    } else if (url.pathname === "/api/layer1-diff") {
        handleFixtureDiffRequest(response, url.searchParams);
    } else if (url.pathname === "/api/scan-source") {
        handleFixtureScanSourceRequest(response, url.searchParams);
    } else {
        return false;
    }
    return true;
}

