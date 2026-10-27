// Viewer JSONL-path lookup: one file, one project, or the union across a project's declared sources.

import { Path } from "./structures/domain.ts";
import { buildProjectSources, type SourceEntry } from "./reconstruction_overrides.ts";
import { getMergedProjectPaths, getProjectsDir } from "./viewer_api_projects.ts";
import { scanProjects, type ProjectListing } from "./viewer_api_project_scan.ts";
import { findProjectFile } from "./viewer_api_trust_boundary.ts";

// Append one listing's JSONLs through the trust boundary, skipping paths already seen.
function appendListingJsonlPaths(
  projectsDir: Path,
  listing: ProjectListing,
  seenPaths: Set<string>,
  jsonlPaths: Path[],
): void {
  for (const entry of listing.jsonlFiles) {
    const resolved = findProjectFile(projectsDir, listing.name, entry.fileName.toString());
    const resolvedKey = resolved.toString();
    const isAlreadySeen = seenPaths.has(resolvedKey);
    if (isAlreadySeen) {
      continue;
    }
    seenPaths.add(resolvedKey);
    jsonlPaths.push(resolved);
  }
}

// Collect the JSONLs of every listing under one source's projects root.
function collectOneSourceJsonlPaths(source: SourceEntry, seenPaths: Set<string>, jsonlPaths: Path[]): void {
  for (const listing of scanProjects(source.projectsDir)) {
    appendListingJsonlPaths(source.projectsDir, listing, seenPaths, jsonlPaths);
  }
}

// Find the project JSONL path(s): one named file, a sources union, or every JSONL in the project.
export function findJsonlPaths(projectName: string, jsonlName: string | null): Path[] {
  if (jsonlName !== null) {
    return [findProjectFile(getProjectsDir(), projectName, jsonlName)];
  }
  const wireEntry = getMergedProjectPaths(projectName);
  if (wireEntry.sources !== undefined) {
    const seenPaths = new Set<string>();
    const jsonlPaths: Path[] = [];
    for (const source of buildProjectSources(getProjectsDir(), wireEntry)) {
      collectOneSourceJsonlPaths(source, seenPaths, jsonlPaths);
    }
    return jsonlPaths;
  }
  let listing: ProjectListing | undefined;
  for (const candidate of scanProjects(getProjectsDir())) {
    if (candidate.name === projectName) {
      listing = candidate;
      break;
    }
  }
  if (listing === undefined) {
    throw new Error(`no project named ${projectName}`);
  }
  const jsonlPaths: Path[] = [];
  for (const entry of listing.jsonlFiles) {
    jsonlPaths.push(findProjectFile(getProjectsDir(), projectName, entry.fileName.toString()));
  }
  return jsonlPaths;
}
