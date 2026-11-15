// HTTP surface for GET /api/layer1-inverse-repos; parses and frames only, layer1_inverse_repos_wire.ts builds the result.

// import { rmSync } from "node:fs";
import { type ServerResponse } from "node:http";
import { join } from "node:path";
import { buildInverseReposWire } from "./layer1_inverse_repos_wire.ts";
import { Path } from "./structures/domain.ts";
import { validateExistingFolderParam, sendNdjsonBuild } from "./viewer_api_layer1_route.ts";
import { sendJson } from "./viewer_server_routes.ts";

// Beside the other server caches (jfred/.cache), never inside the user's project folder.
export const INVERSE_REPOS_CACHE_FOLDER = join(import.meta.dirname, "..", ".cache", "inverse-repos");

export function getInverseReposStoreFolder(projectFolder: Path): Path {
    const projectFolderName = projectFolder.toString().replaceAll(/[^A-Za-z0-9._-]/g, "-");
    return new Path(join(INVERSE_REPOS_CACHE_FOLDER, projectFolderName));
}

// A bad dir throws before any header, so the server's outer catch 400s it.
export function sendLayer1InverseReposResponse(response: ServerResponse, query: URLSearchParams): void {
    const projectFolder = validateExistingFolderParam(query, "dir");
    const jsonlFolders = query.getAll("jsonl").map((jsonlFolder) => new Path(jsonlFolder));
    const snapshotFolders = query.getAll("snapshots").map((snapshotsFolder) => new Path(snapshotsFolder));
    const storeFolder = getInverseReposStoreFolder(projectFolder);
    // The store folder stays, so each repo is reused by its stamp.
    // rmSync(storeFolder.toString(), { recursive: true, force: true });
    const progressParam = query.get("progress");
    if (progressParam !== "1") {
        sendJson(response, 200, buildInverseReposWire(projectFolder, jsonlFolders, snapshotFolders, storeFolder));
        return;
    }
    const buildStreamedWire = (writeNdjsonLine: (value: unknown) => void) => buildInverseReposWire(projectFolder, jsonlFolders, snapshotFolders, storeFolder, writeNdjsonLine);
    sendNdjsonBuild(response, buildStreamedWire);
}
