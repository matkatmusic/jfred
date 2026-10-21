// Fixture self-checks, one function per layer; a failed check throws when the loader module is imported.

import { WireConfidence, WireEditKind } from "../webapp/layer1-wire.ts";
import type { BulkFixtureTarget } from "./viewer_api_fixture_bulk.ts";
import { parseMs, type FixtureDisk, type FixtureSession } from "./viewer_api_layer1_fixture_data.ts";
import type { FixtureEvent } from "./viewer_api_layer3_fixture_data.ts";
import { replayFixtureEvent } from "./viewer_api_layer3_fixture_replay.ts";

interface PlacementContext {
  diskByPath: Map<string, FixtureDisk>;
  sessionByFile: Map<string, FixtureSession>;
}

function isOnTitleLine(owner: FixtureSession, line: number): boolean {
  for (const title of owner.titles) {
    const isInRange = line >= title.from && line <= title.to;
    if (isInRange) {
      return true;
    }
  }
  return false;
}

function buildPlacementContext(target: BulkFixtureTarget): PlacementContext {
  const diskByPath = new Map<string, FixtureDisk>();
  for (const d of target.disk) {
    const isSeen = diskByPath.has(d.path);
    if (!isSeen) {
      diskByPath.set(d.path, d);
    }
  }
  const sessionByFile = new Map<string, FixtureSession>();
  for (const x of target.sessions) {
    const isSeen = sessionByFile.has(x.file);
    if (!isSeen) {
      sessionByFile.set(x.file, x);
    }
  }
  return { diskByPath, sessionByFile };
}

// born <= at <= mtime, inside the owning session's window, on a title line.
function listPlacementProblems(
  where: string, atIso: string, path: string, session: string, line: number, context: PlacementContext,
): string[] {
  const problems: string[] = [];
  const atMs = parseMs(atIso);
  const disk = context.diskByPath.get(path);
  const owner = context.sessionByFile.get(session);
  if (!disk) {
    problems.push(`${where}: no DISK entry`);
  }
  else if (atMs < parseMs(disk.born)) {
    problems.push(`${where}: before born ${disk.born}`);
  }
  else if (atMs > parseMs(disk.at)) {
    problems.push(`${where}: after mtime ${disk.at}`);
  }
  if (!owner) {
    problems.push(`${where}: owning session is missing`);
    return problems;
  }
  const isOutsideWindow = atMs < parseMs(owner.started) || atMs > parseMs(owner.ended);
  const isOffTitles = owner.titles.length > 0 && !isOnTitleLine(owner, line);
  if (isOutsideWindow) {
    problems.push(`${where}: outside its session's window`);
  }
  else if (isOffTitles) {
    problems.push(`${where}: line ${line} is in no title range`);
  }
  return problems;
}

function throwIfAny(heading: string, problems: string[]): void {
  if (problems.length > 0) {
    throw new Error(`${heading}:\n  ${problems.join("\n  ")}`);
  }
}

export function assertFixtureOrder(target: BulkFixtureTarget): void {
  const context = buildPlacementContext(target);
  const bad: string[] = [];
  for (const s of target.snapshots) {
    bad.push(...listPlacementProblems(`${s.path} ${s.version} (${s.session})`, s.at, s.path, s.session, s.line, context));
  }
  throwIfAny("fixture is out of order", bad);
}

function listHunkProblems(where: string, event: FixtureEvent): string[] {
  if (event.hunks === undefined || event.hunks.length === 0) {
    return [`${where}: an edit has no hunks`];
  }
  const problems: string[] = [];
  for (const hunk of event.hunks) {
    const oldRows = hunk.lines.filter((row) => row.startsWith(" ") || row.startsWith("-")).length;
    const newRows = hunk.lines.filter((row) => row.startsWith(" ") || row.startsWith("+")).length;
    const unprefixed = hunk.lines.filter((row) => !/^[ +-]/.test(row)).length;
    if (hunk.oldLines !== oldRows || hunk.newLines !== newRows) {
      problems.push(`${where}: hunk counts ${hunk.oldLines}/${hunk.newLines} disagree with its rows ${oldRows}/${newRows}`);
    }
    if (hunk.oldStart < 1 || hunk.newStart < 1) {
      problems.push(`${where}: hunk starts at line ${hunk.oldStart}/${hunk.newStart}`);
    }
    if (unprefixed > 0) {
      problems.push(`${where}: ${unprefixed} hunk rows have no + - or space prefix`);
    }
  }
  return problems;
}

function listEventProblems(event: FixtureEvent, context: PlacementContext): string[] {
  const where = `${event.path} ${event.kind} ${event.changeId} (${event.session})`;
  const problems = listPlacementProblems(where, event.at, event.path, event.session, event.line, context);
  if (event.kind === WireEditKind.edit) {
    problems.push(...listHunkProblems(where, event));
  }
  if (event.kind === WireEditKind.write && (event.content ?? []).length === 0) {
    problems.push(`${where}: a write has no content`);
  }
  if (problems.length > 0) {
    return problems;
  }
  const expected = event.expectDerived === true ? WireConfidence.derived : WireConfidence.verified;
  const replayed = replayFixtureEvent(event).confidence;
  return replayed === expected ? [] : [`${where}: replay says ${replayed}, the fixture declares ${expected}`];
}

export function assertEventsPlaced(target: BulkFixtureTarget): void {
  const context = buildPlacementContext(target);
  const bad: string[] = [];
  for (const event of target.edits) {
    bad.push(...listEventProblems(event, context));
  }
  throwIfAny("fixture events are out of place", bad);
}

export function assertScriptRunsInSessions(target: BulkFixtureTarget): void {
  for (const run of target.scriptRuns) {
    const runMs = parseMs(run.at);
    let isInWindow = false;
    for (const session of target.sessions) {
      const isOwner = session.file === run.session;
      if (isOwner) {
        isInWindow = runMs >= parseMs(session.started) && runMs <= parseMs(session.ended);
      }
    }
    if (!isInWindow) {
      throw new Error(`script run ${run.toolUseId} is outside session ${run.session}`);
    }
  }
}

export function assertFixture(target: BulkFixtureTarget): void {
  assertFixtureOrder(target);
  assertEventsPlaced(target);
  assertScriptRunsInSessions(target);
}
