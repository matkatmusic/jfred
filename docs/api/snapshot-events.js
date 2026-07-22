// snapshot-events: the snapshot/fileAbsent beacon extractor for the sidecar
// event representation. A file-history-snapshot record's trackedFileBackups
// entry becomes a Tier-1 beacon — a live on-disk blob -> 'snapshot'; a null
// backupFileName -> 'fileAbsent' (positive evidence the file did not exist then).
// Extracted from file-events-extractors (roadmap item 1) so the orchestrator
// lands under the 250-line cap. Builds events through file-event-kinds
// .createKindEvent (the shared home -> no file-events-extractors require cycle).

var fs = require('fs');
var path = require('path');
var os = require('os');
var createKindEvent = require('./file-event-kinds').createKindEvent;
var doesEditBelongToFile = require('./file-historical-lineage').doesEditBelongToFile;

// The default file-history snapshot blob root (~/.claude/file-history).
function getDefaultSnapshotsBase() {
  return path.join(os.homedir(), '.claude', 'file-history');
}

// One beacon event from one tracked-backup entry, or null. backupFileName
// null is the absence beacon; a non-null name must resolve to a LIVE blob
// (record -> blob chain broken = no beacon).
function buildBackupKindEvent(jsonlPath, jsonlLine, record, entry, sessionId, snapshotsBase) {
  if (!entry) { return null; }
  var isoTimestamp = record.snapshot.timestamp;
  if (!isoTimestamp) { return null; }
  if (!entry.backupFileName) {
    return createKindEvent(jsonlPath, jsonlLine, isoTimestamp, 'fileAbsent', {});
  }
  if (!sessionId) { return null; }
  var blobPath = path.join(snapshotsBase, sessionId, entry.backupFileName);
  if (!fs.existsSync(blobPath)) { return null; }
  var kindFields = { blob: blobPath, isSnapshotUpdate: record.isSnapshotUpdate === true };
  return createKindEvent(jsonlPath, jsonlLine, isoTimestamp, 'snapshot', kindFields);
}

// The FULL alias path whose '/'+key suffix matches the repo-relative snapshot
// key (or the key itself when it already is an exact alias path). The window
// filter keys on full absolute alias paths, so a snapshot event must carry the
// matched FULL path, not the repo-relative key — else its window lookup misses
// and the event is wrongly dropped. Mirrors anyAliasPathEndsWith's suffix rule.
function matchAliasPathToSnapshotKey(key, aliasPaths) {
  if (aliasPaths.indexOf(key) !== -1) { return key; }
  var suffix = '/' + key;
  for (var i = 0; i < aliasPaths.length; i++) {
    if (aliasPaths[i].length <= suffix.length) { continue; }
    if (aliasPaths[i].lastIndexOf(suffix) === aliasPaths[i].length - suffix.length) { return aliasPaths[i]; }
  }
  return key;
}

// Append the events of one snapshot record's matching backups.
function appendSnapshotRecordEvents(events, jsonlPath, jsonlLine, record, ctxt) {
  var backups = record.snapshot.trackedFileBackups ? record.snapshot.trackedFileBackups : {};
  var keys = Object.keys(backups);
  for (var k = 0; k < keys.length; k++) {
    if (!doesEditBelongToFile({ filePath: keys[k], source: 'snapshot' }, ctxt.aliasSet, ctxt.aliasPaths)) { continue; }
    var event = buildBackupKindEvent(jsonlPath, jsonlLine, record, backups[keys[k]], ctxt.sessionId, ctxt.snapshotsBase);
    if (event) {
      event.aliasPath = matchAliasPathToSnapshotKey(keys[k], ctxt.aliasPaths);
      events.push(event);
    }
  }
}

// Resume-copied snapshots repeat the previous session's entry with its OLD
// embedded snapshot.timestamp — dedup by (messageId, snapshot.timestamp).
function buildSnapshotDeduplicationKey(record) {
  return record.messageId + '|' + record.snapshot.timestamp;
}

// snapshot/fileAbsent beacon events for this file across the transcript.
function extractSnapshotEventsForFile(jsonlPath, parsed, ctxt) {
  var seen = new Set();
  var events = [];
  for (var i = 0; i < parsed.length; i++) {
    var record = parsed[i];
    if (!record) { continue; }
    if (record.type !== 'file-history-snapshot') { continue; }
    if (!record.snapshot) { continue; }
    var dedupKey = buildSnapshotDeduplicationKey(record);
    if (seen.has(dedupKey)) { continue; }
    seen.add(dedupKey);
    appendSnapshotRecordEvents(events, jsonlPath, i + 1, record, ctxt);
  }
  return events;
}

module.exports = {
  getDefaultSnapshotsBase: getDefaultSnapshotsBase,
  buildBackupKindEvent: buildBackupKindEvent,
  appendSnapshotRecordEvents: appendSnapshotRecordEvents,
  buildSnapshotDeduplicationKey: buildSnapshotDeduplicationKey,
  extractSnapshotEventsForFile: extractSnapshotEventsForFile
};
