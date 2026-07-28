// The layered-graph server surface (task 206, spec S7/S8 plumbing): serve loadLayeredProject's graph for one project to the layered page. HTTP wiring stays in viewer_server.ts; this file parses the query, resolves the project, and serializes (precedent: viewer_api_repo.ts).

import { type ServerResponse } from "node:http";
import { join } from "node:path";
import { resolveInstantOffsets } from "../webapp/layer1-ruler-axis.ts";
import { loadLayeredProject } from "./layered_load.ts";
import { mergeSessionTimelines } from "./layered_merge.ts";
import type { Instant, ReconstructionEntity, ReconstructionGraph } from "./layered_types.ts";
import { Path } from "./structures/domain.ts";
import { getProjectsDir, scanProjects } from "./viewer_api_projects.ts";
import { requireParam, sendJson } from "./viewer_server_routes.ts";

// The graph as the layered page consumes it: every stored field, plus each entity's spec-S8 corroborated instants. The stored truth stays the per-session timelines (Q13) — this addition is derived, and travels only because the page cannot compute it.
interface WireLayeredEntity extends ReconstructionEntity {
    corroboratedInstants: Instant[];
}

interface WireLayeredGraph extends Omit<ReconstructionGraph, "entities"> {
    entities: WireLayeredEntity[];
    // Every instant in the graph, keyed by its ISO text, resolved to its pixel offset on the one shared ruler (task 239). The page reads an offset by the same ISO string its nodes already carry on the wire, so no instant arithmetic survives in the browser.
    axisOffsetsPx: Record<string, number>;
}

// Spec S8's dashed cross-lane lines sit exactly where S5 marked corroboration — a property of the DERIVED merged view (`mergeSessionTimelines`), never of the stored per-session timelines.  webapp/ may not import from src/, so the merge runs here and only its S8 input travels: the instants whose bytes two DISTINCT sessions both observed.
function listCorroboratedInstants(entity: ReconstructionEntity): Instant[] {
    return mergeSessionTimelines(entity).nodes
        .filter((merged) => merged.corroboratedBy.length > 0)
        .map((merged) => merged.node.instant);
}

// The S18 capped-gap ruler ACCUMULATES — an instant's pixel offset depends on every earlier gap, so it cannot be derived from that instant alone and CSS cannot express it the way S8's `--axis-ms` was (task 239). resolveInstantOffsets runs once here over the WHOLE graph, so every widget, node dot and corroboration line shares one axis; the page then emits a single finished number per element and layered-styles.css still does all the placing.
function mapInstantsToAxisPixels(entities: WireLayeredEntity[]): Record<string, number> {
    const instants = entities.flatMap((entity) => [
        ...entity.corroboratedInstants,
        ...entity.sessionTimelines.flatMap((session) => session.timeline.nodes.map((node) => node.instant)),
    ]);
    return Object.fromEntries(resolveInstantOffsets(instants)
        .map((position) => [position.instant.toISOString(), position.offsetPx]));
}

function describeGraphForWire(graph: ReconstructionGraph): WireLayeredGraph {
    const entities = graph.entities.map((entity) => ({
        ...entity,
        corroboratedInstants: listCorroboratedInstants(entity),
    }));
    return { ...graph, entities, axisOffsetsPx: mapInstantsToAxisPixels(entities) };
}

// GET /api/layered-graph?project=<name> — the project's layered ReconstructionGraph as JSON (Path/Uuid serialize via toJSON, Dates to ISO strings — the graph is JSON-clean as-is).  scanProjects membership doubles as the traversal guard: an unknown or path-shaped name throws into the server's outer catch (400), the same posture as resolveJsonlPaths' legacy branch.
export function handleLayeredGraphRequest(response: ServerResponse, query: URLSearchParams): void {
    const projectName = requireParam(query, "project");
    const listing = scanProjects(getProjectsDir()).find((project) => project.name === projectName);
    if (listing === undefined) {
        throw new Error(`no project named ${projectName}`);
    }
    const projectFolder = new Path(join(getProjectsDir().toString(), projectName));
    sendJson(response, 200, describeGraphForWire(loadLayeredProject(projectFolder, {})));
}
