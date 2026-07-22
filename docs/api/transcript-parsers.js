// Raw JSONL text → parsed records and session facts.
// Home of transcript parsing: parseTranscriptRecords, user-prompt detection/extraction,
// and session metadata. Loadable in Node (require) and the browser (script tag).

// Find the first text item in a content array, or '' if none.
function findFirstTextContentItem(items) {
  for (var j = 0; j < items.length; j++) {
    if (items[j].type === 'text' && items[j].text) {
      return items[j].text;
    }
  }
  return '';
}

// Extract the first text string from a message content value.
// Returns the text or '' if none found.
function extractTextFromContent(c) {
  if (typeof c === 'string') {
    return c;
  }
  if (Array.isArray(c)) {
    return findFirstTextContentItem(c);
  }
  return '';
}

// Check if text looks like a CLI command artifact.
function isCommandArtifact(txt) {
  return /^<(command-name|local-command|command-message)/.test(txt);
}

// Identify conversational user prompts — messages where the user typed something.
// Excludes tool_result messages (system-generated responses to tool_use calls)
// and CLI command artifacts (/exit, /clear, etc.) which generate internal
// message sequences with backward parentUuid jumps that look like rewinds.
function isUserPrompt(obj) {
  if (!obj || obj.type !== 'user' || !obj.message) {
    return false;
  }
  // Harness-injected meta messages (e.g. the post-compaction "Continue from
  // where you left off." continuation) carry isMeta:true. They are not genuine
  // user prompts: treating one as a rewind landing invents a phantom
  // code-restoration rewind across the compaction boundary, discarding every
  // file write made after it.
  if (obj.isMeta === true) {
    return false;
  }
  var c = obj.message.content;
  if (Array.isArray(c) && c.length > 0 && c[0].type === 'tool_result') {
    return false;
  }
  if (isCommandArtifact(extractTextFromContent(c))) {
    return false;
  }
  return true;
}

// Extract the user's text from a user message object.
function extractUserText(obj) {
  return extractTextFromContent(obj.message.content);
}

// Build a single prompt entry from a parsed object at index i.
function buildPromptEntry(parsed, uuidToIdx, i) {
  var parentLine = parsed[i].parentUuid ? uuidToIdx[parsed[i].parentUuid] : -1;
  return {
    line: i,
    parentLine: parentLine !== undefined ? parentLine : -1,
    text: extractUserText(parsed[i]),
    uuid: parsed[i].uuid,
    parentUuid: parsed[i].parentUuid
  };
}

// Collect all user prompts with resolved parent line indices.
function collectUserPrompts(parsed, uuidToIdx) {
  var prompts = [];
  for (var i = 0; i < parsed.length; i++) {
    if (isUserPrompt(parsed[i])) {
      prompts.push(buildPromptEntry(parsed, uuidToIdx, i));
    }
  }
  return prompts;
}

// Extract version info from a file-history-snapshot object.
function extractSnapshot(obj, lineIdx) {
  var snap = obj.snapshot || {};
  var backups = snap.trackedFileBackups || {};
  var fileVersions = {};
  Object.keys(backups).forEach(function (f) {
    var b = backups[f];
    if (b && typeof b === 'object') {
      fileVersions[f] = { version: b.version, backup: b.backupFileName || null };
    }
  });
  return { line: lineIdx, msgId: snap.messageId, files: fileVersions };
}

// Check if a toolUseResult represents a file write.
function isFileWrite(tr) {
  return tr && (tr.type === 'create' || tr.type === 'update' || tr.type === 'edit'
    || tr.originalFile !== undefined || tr.oldString !== undefined
    || tr.old_string !== undefined || tr.newString !== undefined
    || tr.new_string !== undefined);
}

// Build a file-write entry from a parsed object at index i.
function buildFileWriteEntry(obj, i) {
  var tr = obj.toolUseResult;
  var file = (tr.filePath || '').split('/').pop();
  return { line: i, file: file, type: tr.type || 'edit' };
}

// Index a single parsed line into the data structures.
function addParsedLineToUuidAndSnapshotLookups(obj, i, uuidToIdx, snapshots, fileWrites) {
  if (obj.uuid) {
    uuidToIdx[obj.uuid] = i;
  }
  if (obj.type === 'file-history-snapshot') {
    snapshots.push(extractSnapshot(obj, i));
  }
  if (isFileWrite(obj.toolUseResult)) {
    fileWrites.push(buildFileWriteEntry(obj, i));
  }
}

// Try to parse a single JSON line, returning the object or null.
function parseSingleLine(line) {
  try {
    return JSON.parse(line);
  } catch (e) {
    return null;
  }
}

// Parse JSONL text into indexed data structures.
function parseTranscriptRecords(text) {
  var lines = text.split('\n').filter(Boolean);
  var parsed = [];
  var uuidToIdx = {};
  var snapshots = [];
  var fileWrites = [];
  for (var i = 0; i < lines.length; i++) {
    var obj = parseSingleLine(lines[i]);
    parsed.push(obj);
    if (obj) {
      addParsedLineToUuidAndSnapshotLookups(obj, i, uuidToIdx, snapshots, fileWrites);
    }
  }
  return { parsed: parsed, uuidToIdx: uuidToIdx, snapshots: snapshots, fileWrites: fileWrites };
}

// Find the first system record in JSONL lines array.
function findSystemRecord(lines) {
  for (var i = 0; i < lines.length; i++) {
    var obj = parseSingleLine(lines[i]);
    if (obj && obj.type === 'system') { return obj; }
  }
  return null;
}

// Extract session metadata (gitBranch, cwd, sessionId) from JSONL text.
function extractSessionMetadata(jsonlText) {
  var sys = findSystemRecord(jsonlText.split('\n').filter(Boolean));
  if (!sys) { return { gitBranch: null, cwd: null, sessionId: null }; }
  return {
    gitBranch: sys.gitBranch || null,
    cwd: sys.cwd || null,
    sessionId: sys.sessionId || null
  };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    parseTranscriptRecords: parseTranscriptRecords,
    isUserPrompt: isUserPrompt,
    extractUserText: extractUserText,
    collectUserPrompts: collectUserPrompts,
    extractSessionMetadata: extractSessionMetadata
  };
}
