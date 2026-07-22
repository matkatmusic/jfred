// track-line-states (api): the per-line file-state tracking sidecar engine.
// Applies extracted file events (api/file-events-extractors) to an in-memory
// line belief (line-belief + edit-splice, via api/apply-one-event), emitting the
// timestamp-keyed tracking object: beacons anchor truth and collapse entries to
// lines:"ALL"; observations corroborate or contradict belief (contradictions
// become conflict records localized to an inter-beacon window); the finalVerdict
// compares final belief per line against the best available reference. Runs
// BESIDE the existing reconstruction pipeline — it never changes PASS/MISMATCH.
// tools/track-line-states.js is the thin CLI that drives this engine.

var lb = require('./line-belief');
var flv = require('./final-line-verdict');
var applyOneEvent = require('./apply-one-event').applyOneEvent;
var cascadeCollapse = require('./conflict-cascade-collapse');
var conflictRecords = require('./conflict-records');
var gitSeed = require('./git-seed');

// ─── Event ordering ─────────────────────────────────────────────────────────

// originalFile (0) sorts before its own edit (1) so the whole-file overlay pins
// belief BEFORE the splice authors the changed line. Everything else (2) is
// safe: snapshots/writes live in different records (different jsonlLine), so
// they never reach this tie against an edit — only an originalFile and the edit
// it accompanies share a full (unixMs, jsonl, jsonlLine) coordinate.
// item 18: a userModified event shares the edit's coordinate too, and MUST stay
// the rank-2 fallthrough (NO case here) so its conservative EOF drift applies to
// POST-edit belief (originalFile 0 -> edit 1 -> userModified 2).
function computeKindRank(event) {
  if (event.originalFile) { return 0; }
  if (event.edit) { return 1; }
  return 2;
}

// Deterministic order: time, then transcript path, then line, then kind — reruns
// reproduce the same timeline exactly.
function compareEvents(a, b) {
  if (a.unixMs !== b.unixMs) { return a.unixMs - b.unixMs; }
  if (a.jsonl < b.jsonl) { return -1; }
  if (a.jsonl > b.jsonl) { return 1; }
  if (a.jsonlLine !== b.jsonlLine) { return a.jsonlLine - b.jsonlLine; }
  return computeKindRank(a) - computeKindRank(b);
}

// Events sharing a millisecond share one timeline entry.
function groupEventsByMs(events) {
  var sorted = events.slice().sort(compareEvents);
  var groups = [];
  var current = null;
  for (var i = 0; i < sorted.length; i++) {
    var startsNewGroup = current === null ? true : current.unixMs !== sorted[i].unixMs;
    if (startsNewGroup) {
      current = { unixMs: sorted[i].unixMs, events: [] };
      groups.push(current);
    }
    current.events.push(sorted[i]);
  }
  return groups;
}

// Tier-1 beacons: snapshot, absence, success-confirmed write.
function isBeaconEvent(event) {
  if (event.snapshot) { return true; }
  if (event.fileAbsent) { return true; }
  return event.write !== null;
}

// ─── Timeline records ─────────────────────────────────────────────────────────
// (Conflict-record schema construction lives in api/conflict-records.js.)

// Lines whose entry was established/verified at this exact instant.
function collectTouchedLinesAtTimestamp(belief, unixMs) {
  var touched = new Set();
  var lineNums = Object.keys(belief.entries).map(Number);
  for (var i = 0; i < lineNums.length; i++) {
    if (belief.entries[lineNums[i]].confirmedAtMs === unixMs) { touched.add(lineNums[i]); }
  }
  return touched;
}

// Belief AFTER this instant's events: beacons collapse to "ALL" (one reference
// covers every line); otherwise the per-line evidence map. matchingCommits is
// attached only when non-empty, so a non-git run's report shape is unchanged.
function buildTimelineEntry(group, belief, groupIsBeacon, matchingCommits) {
  var entry = {
    timestamp: group.events[0].timestamp,
    isBeacon: groupIsBeacon,
    events: group.events,
    lines: groupIsBeacon ? 'ALL' : lb.cloneEntriesForTimeline(belief),
    printTestSummary: lb.summarizeBelief(belief)
  };
  if (matchingCommits.length > 0) { entry.matchingCommits = matchingCommits; }
  return entry;
}

// The committed-version matches for this belief, or [] when no matcher was injected.
function computeCommitMatchesForBelief(matcher, belief) {
  return matcher ? matcher(belief) : [];
}

// ─── The tracker ────────────────────────────────────────────────────────────

// A FULL belief clone that KEEPS each entry's in-memory .text — unlike
// lb.cloneEntriesForTimeline, which drops text for persistence. The verdict
// compares text, so the historical-belief fallback needs the text preserved.
function cloneBeliefWithText(belief) {
  var clone = { entries: {}, lastLine: belief.lastLine, eofConfirmed: belief.eofConfirmed, lastBeaconMs: belief.lastBeaconMs };
  var lineNums = Object.keys(belief.entries);
  for (var i = 0; i < lineNums.length; i++) {
    var entry = belief.entries[lineNums[i]];
    clone.entries[lineNums[i]] = {
      state: entry.state,
      confirmedAtMs: entry.confirmedAtMs,
      numberingCertain: entry.numberingCertain,
      evidence: entry.evidence,
      text: entry.text
    };
  }
  return clone;
}

// True when any event in this instant's group is a fileAbsent beacon — the
// signal to snapshot belief before applyEventGroup erases it.
function checkGroupHasFileAbsentEvent(group) {
  for (var e = 0; e < group.events.length; e++) {
    if (group.events[e].fileAbsent) { return true; }
  }
  return false;
}

// Which belief the final verdict compares: normally the end-state belief, but
// when belief ended EMPTY while a reference still exists (the file is live now)
// and a populated belief was captured before a fileAbsent cleared it, that
// historical belief is the honest reconstruction — empty-vs-reference would
// otherwise mislabel every line neverObserved.
function selectBeliefForVerdict(belief, lastPopulatedBelief, reference) {
  if (Object.keys(belief.entries).length > 0) { return belief; }
  if (!lastPopulatedBelief) { return belief; }
  if (reference.via === 'none') { return belief; }
  return lastPopulatedBelief;
}

// Apply one instant's events in order; returns whether any was a beacon.
// Conflicts are windowed against the beacon that PRECEDED this instant.
function applyEventGroup(belief, group, conflicts) {
  var groupIsBeacon = false;
  for (var e = 0; e < group.events.length; e++) {
    var infos = applyOneEvent(belief, group.events[e]);
    conflictRecords.appendConflictRecords(conflicts, infos, group.unixMs, belief.lastBeaconMs);
    if (isBeaconEvent(group.events[e])) {
      belief.lastBeaconMs = group.unixMs;
      groupIsBeacon = true;
    }
  }
  return groupIsBeacon;
}

// Replay every event in deterministic order, anchoring at beacons and
// accumulating/verifying between them. options: {filePath, aliasPaths,
// jsonlsScanned, reference:{via, content}}.
function trackLineStates(events, options) {
  var opts = options ? options : {};
  var belief = lb.createBelief();
  // Opt-in git-seed beacon: seed belief from the commit's file content as a
  // Tier-1 observed baseline, then replay ONLY the events strictly after the
  // commit instant. With no seed, belief starts empty exactly as before.
  if (opts.gitSeed) {
    gitSeed.seedBeliefFromGitContent(belief, opts.gitSeed.content, opts.gitSeed.seedMs, opts.gitSeed.sha);
    events = gitSeed.filterEventsAfter(events, opts.gitSeed.seedMs);
  }
  var timeline = {};
  var conflicts = [];
  var lastPopulatedBelief = null;
  var groups = groupEventsByMs(events);
  for (var g = 0; g < groups.length; g++) {
    // Capture belief BEFORE a fileAbsent beacon clears it, so a deletion that
    // ends the timeline does not erase a reconstruction the reference confirms.
    if (checkGroupHasFileAbsentEvent(groups[g])) {
      if (Object.keys(belief.entries).length > 0) { lastPopulatedBelief = cloneBeliefWithText(belief); }
    }
    var groupIsBeacon = applyEventGroup(belief, groups[g], conflicts);
    lb.degradeUntouchedToPresumed(belief, collectTouchedLinesAtTimestamp(belief, groups[g].unixMs));
    var matches = computeCommitMatchesForBelief(opts.committedVersionMatcher, belief);
    timeline[String(groups[g].unixMs)] = buildTimelineEntry(groups[g], belief, groupIsBeacon, matches);
  }
  var reference = opts.reference ? opts.reference : { via: 'none', content: null };
  var beliefForVerdict = selectBeliefForVerdict(belief, lastPopulatedBelief, reference);
  var finalVerdict = flv.buildFinalVerdict(beliefForVerdict, reference);
  if (beliefForVerdict !== belief) { finalVerdict.verdictUsedHistorical = true; }
  return {
    filePath: opts.filePath ? opts.filePath : null,
    aliasPaths: opts.aliasPaths ? opts.aliasPaths : [],
    jsonlsScanned: opts.jsonlsScanned ? opts.jsonlsScanned : [],
    timeline: timeline,
    conflicts: cascadeCollapse.collapseConflictCascades(conflicts),
    finalVerdict: finalVerdict
  };
}

module.exports = {
  trackLineStates: trackLineStates
};
