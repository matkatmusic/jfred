// Build intermediate file state at every replay step.
// Produces a timeline of step objects showing how a file evolved.
// Moved (Phase 5) from common/file-state-history.js, bodies unchanged;
// applySingleEdit now comes from api/edit-replay.

var applySingleEdit;
if (typeof module !== 'undefined' && typeof require === 'function') {
  applySingleEdit = require('./edit-replay').applySingleEdit;
}

// Build the edit sub-object for a create or update step.
function buildContentEditSub(edit) {
  return { content: edit.content };
}

// Build the edit sub-object for a string-replacement step.
function buildReplaceEditSub(edit) {
  return { oldString: edit.oldString, newString: edit.newString };
}

// Build the edit sub-object appropriate for the edit type.
function buildEditSub(edit) {
  if (edit.type === 'edit') { return buildReplaceEditSub(edit); }
  return buildContentEditSub(edit);
}

// Check if originalFile is a meaningful value (non-null, non-empty).
function hasOriginalFile(edit) {
  return edit.originalFile !== null && edit.originalFile !== undefined && edit.originalFile !== '';
}

// Detect whether a user edited the file between this edit and the previous step.
function isUserEditGap(edit, previousContents) {
  if (!hasOriginalFile(edit)) { return false; }
  return edit.originalFile !== previousContents;
}

// Build one step object from an edit, its computed contents, and state context.
function buildStepObject(edit, contents, expectedState, actualState) {
  return {
    type: edit.type,
    filename: edit.file,
    contents: contents,
    expectedState: expectedState,
    actualState: actualState,
    isUserEdit: false,
    edit: buildEditSub(edit),
    jsonl: { line: edit.line },
    timestamp: null
  };
}

// Build a user-edit step that represents the user's modification between agent edits.
function buildUserEditStep(edit, previousContents) {
  return {
    type: 'edit',
    filename: edit.file,
    contents: edit.originalFile,
    expectedState: previousContents,
    actualState: edit.originalFile,
    isUserEdit: true,
    edit: { content: edit.originalFile },
    jsonl: { line: edit.line },
    timestamp: null
  };
}

// Determine the actualState for a step based on available independent sources.
function resolveActualState(edit) {
  if (hasOriginalFile(edit)) { return edit.originalFile; }
  return null;
}

// Build the history array from a list of edits, emitting user-edit steps as needed.
function buildFileStateHistory(edits) {
  var steps = [];
  var previousContents = '';
  for (var i = 0; i < edits.length; i++) {
    if (isUserEditGap(edits[i], previousContents)) {
      steps.push(buildUserEditStep(edits[i], previousContents));
      previousContents = edits[i].originalFile;
    }
    var contents = applySingleEdit(edits[i], previousContents);
    var step = buildStepObject(edits[i], contents, previousContents, resolveActualState(edits[i]));
    steps.push(step);
    previousContents = contents;
  }
  return steps;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    buildFileStateHistory: buildFileStateHistory
  };
}
