// Layered-graph server surface: resolve the project and serialize its graph.

import { type ServerResponse } from "node:http";
import { join } from "node:path";
import { computeInstantOffsets } from "../webapp/layer1-ruler-axis.ts";
import { loadLayeredProject } from "./layered_load.ts";
import { mergeSessionTimelines } from "./layered_merge.ts";
import type { Instant, ReconstructionEntity, ReconstructionGraph } from "./layered_types.ts";
import { Path } from "./structures/domain.ts";
import { getProjectsDir } from "./viewer_api_projects.ts";
import { scanProjects } from "./viewer_api_project_scan.ts";
import { getRequiredParam, sendJson } from "./viewer_server_routes.ts";

// The graph as the layered page reads it: stored fields plus derived corroborated instants.
interface WireLayeredEntity extends ReconstructionEntity {
  corroboratedInstants: Instant[];
}

interface WireLayeredGraph extends Omit<ReconstructionGraph, "entities"> {
  entities: WireLayeredEntity[];
  // Pixel offset on the shared ruler, keyed by each instant's ISO text.
  axisOffsetsPx: Record<string, number>;
}

// Instants whose bytes two distinct sessions both observed, from the derived merged view.
function listCorroboratedInstants(entity: ReconstructionEntity): Instant[] {
  const instants: Instant[] = [];
  for (const merged of mergeSessionTimelines(entity).nodes) {
    const isCorroborated = merged.corroboratedBy.length > 0;
    if (isCorroborated)
      instants.push(merged.node.instant);
  }
  return instants;
}

// The ruler accumulates gaps, so offsets resolve once over the whole graph.
function computeAxisPixelOffsets(entities: WireLayeredEntity[]): Record<string, number> {
  const instants: Instant[] = [];
  for (const entity of entities) {
    instants.push(...entity.corroboratedInstants);
    for (const session of entity.sessionTimelines) {
      for (const node of session.timeline.nodes)
        instants.push(node.instant);
    }
  }
  const offsetEntries: [string, number][] = [];
  for (const position of computeInstantOffsets(instants))
    offsetEntries.push([position.instant.toISOString(), position.offsetPx]);
  return Object.fromEntries(offsetEntries);
}

function buildGraphForWire(graph: ReconstructionGraph): WireLayeredGraph {
  const entities: WireLayeredEntity[] = [];
  for (const entity of graph.entities)
    entities.push({ ...entity, corroboratedInstants: listCorroboratedInstants(entity) });
  return { ...graph, entities, axisOffsetsPx: computeAxisPixelOffsets(entities) };
}

// GET /api/layered-graph?project=<name>; scanProjects membership is the traversal guard.
export function sendLayeredGraphResponse(response: ServerResponse, query: URLSearchParams): void {
  const projectName = getRequiredParam(query, "project");
  let isKnownProject = false;
  for (const listing of scanProjects(getProjectsDir())) {
    if (listing.name === projectName)
      isKnownProject = true;
  }
  if (!isKnownProject) {
    throw new Error(`no project named ${projectName}`);
  }
  const projectFolder = new Path(join(getProjectsDir().toString(), projectName));
  sendJson(response, 200, buildGraphForWire(loadLayeredProject(projectFolder, {})));
}
