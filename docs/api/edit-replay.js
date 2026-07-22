// edit-replay: apply an ordered edit sequence (or one edit) to file content.
// The in-memory replay half of the reconstruction engine. Moved (Phase 5) from
// common/replay-edits.js, bodies unchanged. Pure — no IO, no console, no argv.

// ─── Helpers for replayEdits ────────────────────────────────────────────────

// Apply a create or update edit, returning updated content.
function applyCreateOrUpdate(edit, content) {
  if (edit.source === 'read' || edit.source === 'snapshot') {
    return edit.content !== content ? edit.content : content;
  }
  return edit.content;
}

// Apply a string-replacement edit, returning updated content.
function applyReplaceOp(edit, content) {
  if (edit.originalFile) { content = edit.originalFile; }
  if (edit.replaceAll) { return content.split(edit.oldString).join(edit.newString); }
  var idx = content.indexOf(edit.oldString);
  if (idx >= 0) {
    return content.substring(0, idx) + edit.newString + content.substring(idx + edit.oldString.length);
  }
  return content;
}

// Apply a single edit to content, dispatching by type.
function applySingleEdit(edit, content) {
  if (edit.type === 'create' || edit.type === 'update') { return applyCreateOrUpdate(edit, content); }
  if (edit.type === 'edit') { return applyReplaceOp(edit, content); }
  return content;
}

// Replay edits in memory. Applies edits in order starting from empty string.
function replayEdits(edits) {
  var content = '';
  for (var i = 0; i < edits.length; i++) { content = applySingleEdit(edits[i], content); }
  return content;
}

// ─── Exports ────────────────────────────────────────────────────────────────

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    replayEdits: replayEdits,
    applySingleEdit: applySingleEdit
  };
}
