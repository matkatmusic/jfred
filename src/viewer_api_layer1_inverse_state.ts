// HTTP surface for GET /api/layer1-inverse-state and /api/layer1-inverse-diff; read-only, the repos are built by /api/layer1-inverse-repos.

import { existsSync } from "node:fs";
import { type ServerResponse } from "node:http";
// import { basename, join } from "node:path";
import { basename } from "node:path";
import { getDiffTextBetweenInstants, getInverseCommitAtInstant } from "../engineV3/engineV3_inverse_repo_read.ts";
import { getAbsolutePathFromProjectRelativePath, getInverseRepoFolderForFile } from "../engineV3/engineV3_inverse_repos_for_project.ts";
import { buildInverseCommitWire, type InverseDiffWire, type InverseStateWire } from "./layer1_inverse_repos_wire.ts";
import { Path } from "./structures/domain.ts";
import { getInverseReposStoreFolder } from "./viewer_api_layer1_inverse_repos.ts";
import { validateExistingFolderParam } from "./viewer_api_layer1_route.ts";
import { getRequiredParam, sendJson } from "./viewer_server_routes.ts";

type InverseRepoOfFile = { file: string; repoFolder: Path; fileName: string };

function getInstantParam(query: URLSearchParams, name: string): Date {
    const value = getRequiredParam(query, name);
    const instant = new Date(value);
    if (Number.isNaN(instant.getTime())) {
        throw new Error(`${name} is not a valid time: ${value}`);
    }
    return instant;
}

// A file outside the project folder throws inside getInverseRepoFolderForFile.
function getInverseRepoOfFileParam(query: URLSearchParams): InverseRepoOfFile {
    const projectFolder = validateExistingFolderParam(query, "dir");
    const file = getRequiredParam(query, "file");
    // const absoluteFile = new Path(join(projectFolder.toString(), file));
    const absoluteFile = getAbsolutePathFromProjectRelativePath(projectFolder, file);
    const repoFolder = getInverseRepoFolderForFile(getInverseReposStoreFolder(projectFolder), projectFolder, absoluteFile);
    if (!existsSync(repoFolder.toString())) {
        throw new Error(`the inverse repo of ${file} does not exist: the inverse repos are not built yet`);
    }
    return { file, repoFolder, fileName: basename(file) };
}

export function sendLayer1InverseStateResponse(response: ServerResponse, query: URLSearchParams): void {
    const { file, repoFolder, fileName } = getInverseRepoOfFileParam(query);
    const at = getInstantParam(query, "at");
    const commit = getInverseCommitAtInstant(repoFolder, fileName, at);
    let stateWire: InverseStateWire = { file, commit: null, text: null };
    if (commit !== undefined) {
        stateWire = { file, commit: buildInverseCommitWire(commit), text: commit.text ?? null };
    }
    sendJson(response, 200, stateWire);
}

export function sendLayer1InverseDiffResponse(response: ServerResponse, query: URLSearchParams): void {
    const { file, repoFolder, fileName } = getInverseRepoOfFileParam(query);
    const from = getInstantParam(query, "from");
    const to = getInstantParam(query, "to");
    const diffWire: InverseDiffWire = { file, diff: getDiffTextBetweenInstants(repoFolder, fileName, from, to) };
    sendJson(response, 200, diffWire);
}
