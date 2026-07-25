// The layered-graph server surface (task 206, spec S7/S8 plumbing): serve loadLayeredProject's
// graph for one project to the layered page. HTTP wiring stays in viewer_server.ts; this file
// parses the query, resolves the project, and serializes (precedent: viewer_api_repo.ts).

import { type ServerResponse } from "node:http";
import { join } from "node:path";
import { loadLayeredProject } from "./layered_load.ts";
import { Path } from "./structures/domain.ts";
import { getProjectsDir, scanProjects } from "./viewer_api_projects.ts";
import { requireParam, sendJson } from "./viewer_server_routes.ts";

// GET /api/layered-graph?project=<name> — the project's layered ReconstructionGraph as JSON
// (Path/Uuid serialize via toJSON, Dates to ISO strings — the graph is JSON-clean as-is).
// scanProjects membership doubles as the traversal guard: an unknown or path-shaped name throws
// into the server's outer catch (400), the same posture as resolveJsonlPaths' legacy branch.
export function handleLayeredGraphRequest(response: ServerResponse, query: URLSearchParams): void {
    const projectName = requireParam(query, "project");
    const listing = scanProjects(getProjectsDir()).find((project) => project.name === projectName);
    if (listing === undefined) {
        throw new Error(`no project named ${projectName}`);
    }
    const projectFolder = new Path(join(getProjectsDir().toString(), projectName));
    sendJson(response, 200, loadLayeredProject(projectFolder, {}));
}
