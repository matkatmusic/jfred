// JFReD: All-lines view with conversational grouping and branch detection.

import { state } from './jfred-state.js';
import { renderFileContent } from './jfred-panes.js';

var PREAMBLE_TYPES = { 'last-prompt':1, 'custom-title':1, 'agent-name':1, 'mode':1, 'permission-mode':1, 'bridge-session':1 };

function classifyJsonlLineSubtype(obj) {
  if (!obj || !obj.type) { return 'preamble'; }
  if (PREAMBLE_TYPES[obj.type]) { return 'preamble'; }
  if (obj.type === 'file-history-snapshot') { return 'file-history'; }
  if (obj.type === 'queue-operation') { return 'queue-op'; }
  if (obj.type === 'system') { return 'system'; }
  if (obj.type === 'attachment') { return 'attach'; }
  if (obj.type === 'user') {
    var c = obj.message && obj.message.content;
    if (Array.isArray(c) && c.length > 0 && c[0].type === 'tool_result') {
      return 'tool-result';
    }
    return 'user-prompt';
  }
  if (obj.type === 'assistant') {
    var c = obj.message && obj.message.content;
    if (Array.isArray(c) && c.length > 0) {
      if (c[0].type === 'tool_use') { return 'tool-use'; }
      if (c[0].type === 'thinking') { return 'thinking'; }
    }
    return 'assistant-text';
  }
  return 'preamble';
}

function formatJsonlLineContentPreview(obj) {
  if (!obj || !obj.message) { return '(empty)'; }
  var c = obj.message.content;
  var full = '';
  if (typeof c === 'string') { full = c; }
  else if (Array.isArray(c)) {
    for (var i = 0; i < c.length; i++) {
      if (c[i].type === 'text' && c[i].text) { full = c[i].text; break; }
    }
  }
  return full ? full.replace(/\n/g, ' ').substring(0, 80) : '(empty)';
}

function extractToolUseNameFromLine(obj) {
  var c = obj && obj.message && obj.message.content;
  if (!Array.isArray(c)) { return '?'; }
  for (var i = 0; i < c.length; i++) {
    if (c[i].type === 'tool_use' && c[i].name) { return c[i].name; }
  }
  return '?';
}

// ─── Line label generation ────────────────────────────────────────────────────

function formatJsonlLineLabel(obj, idx) {
  var st = classifyJsonlLineSubtype(obj);
  if (st === 'user-prompt') { return '<span class="al-user">User:</span> ' + escapeHtml(formatJsonlLineContentPreview(obj)); }
  if (st === 'assistant-text') { return '<span class="al-agent">Agent:</span> ' + escapeHtml(formatJsonlLineContentPreview(obj)); }
  if (st === 'thinking') { return '<span class="al-dim">Thinking</span>'; }
  if (st === 'tool-use') { return '<span class="al-tool">tool_use: ' + escapeHtml(extractToolUseNameFromLine(obj)) + '</span>'; }
  if (st === 'tool-result') { return '<span class="al-result">tool_result</span>'; }
  if (st === 'file-history') { return '<span class="al-snap">snapshot</span>'; }
  if (st === 'system') { return '<span class="al-sys">system</span>'; }
  if (st === 'preamble') { return '<span class="al-dim">' + escapeHtml(obj && obj.type || 'preamble') + '</span>'; }
  if (st === 'attach') { return '<span class="al-dim">attachment</span>'; }
  return '<span class="al-dim">L' + (idx + 1) + '</span>';
}

function formatConversationSegmentLabel(obj, idx) {
  var st = classifyJsonlLineSubtype(obj);
  if (st === 'user-prompt') { return '<span class="al-user">User:</span> ' + escapeHtml(formatJsonlLineContentPreview(obj)); }
  if (st === 'assistant-text') { return '<span class="al-agent">Agent:</span> ' + escapeHtml(formatJsonlLineContentPreview(obj)); }
  return formatJsonlLineLabel(obj, idx);
}

// ─── Conversational grouping ──────────────────────────────────────────────────

function isConv(st) { return st === 'user-prompt' || st === 'assistant-text'; }

function buildConversationSegments() {
  var segments = [];
  var parsed = state.parsedLines;
  var convIndices = [];
  for (var i = 0; i < parsed.length; i++) {
    if (isConv(classifyJsonlLineSubtype(parsed[i]))) { convIndices.push(i); }
  }
  var first = convIndices.length > 0 ? convIndices[0] : parsed.length;
  if (first > 0) {
    var ch = [];
    for (var i = 0; i < first; i++) { ch.push(i); }
    segments.push({ idx: -1, children: ch, rw: null });
  }
  for (var ci = 0; ci < convIndices.length; ci++) {
    var idx = convIndices[ci];
    var next = ci + 1 < convIndices.length ? convIndices[ci + 1] : parsed.length;
    var ch = [];
    for (var j = idx + 1; j < next; j++) { ch.push(j); }
    var rw = null;
    for (var r = 0; r < state.rewinds.length; r++) {
      if (state.rewinds[r].landingLine === idx) { rw = state.rewinds[r]; break; }
    }
    segments.push({ idx: idx, children: ch, rw: rw });
  }
  return segments;
}

// ─── Rendering helpers ────────────────────────────────────────────────────────

function isStepLine(lineIdx) {
  return state.stepLines[lineIdx] !== undefined;
}

function countSteps(lines) {
  var n = 0;
  for (var i = 0; i < lines.length; i++) {
    if (isStepLine(lines[i])) { n++; }
  }
  return n;
}

function renderJsonlLineRow(lineIdx) {
  var obj = state.parsedLines[lineIdx];
  var st = classifyJsonlLineSubtype(obj);
  var step = isStepLine(lineIdx);
  var cls = 'al-row al-' + st + (step ? ' al-step' : '');
  var badge = step ? '<span class="al-badge">STEP</span>' : '';
  return '<div class="' + cls + '" data-alidx="' + lineIdx + '">' +
    '<span class="al-num">' + (lineIdx + 1) + '</span>' +
    formatJsonlLineLabel(obj, lineIdx) + badge + '</div>';
}

function collectSegmentFileEditBadges(lines) {
  var edits = {};
  for (var i = 0; i < lines.length; i++) {
    var obj = state.parsedLines[lines[i]];
    var tr = obj && obj.toolUseResult;
    if (!tr || !tr.filePath) { continue; }
    var fn = tr.filePath.split('/').pop();
    var ignored = typeof isLineIgnoredByRewind === 'function' && isLineIgnoredByRewind(lines[i], state.rewinds);
    var key = fn + ':' + (ignored ? 'ignored' : 'kept');
    edits[key] = { fn: fn, ignored: ignored };
  }
  var html = '';
  var keys = Object.keys(edits);
  for (var k = 0; k < keys.length; k++) {
    var e = edits[keys[k]];
    var cls = e.ignored ? 'al-edit-badge al-ignored' : 'al-edit-badge';
    html += ' <span class="' + cls + '">' + escapeHtml(e.fn) + ' ' + (e.ignored ? 'ignored' : 'kept') + '</span>';
  }
  return html;
}

function renderConversationSegment(seg) {
  var all = seg.idx >= 0 ? [seg.idx].concat(seg.children) : seg.children;
  if (all.length === 0) { return ''; }
  var obj = seg.idx >= 0 ? state.parsedLines[seg.idx] : null;
  var label = obj ? formatConversationSegmentLabel(obj, seg.idx) : '<span class="al-sys">system</span>';
  var sc = countSteps(all);
  var badge = sc > 0 ? ' <span class="al-badge">' + sc + ' step' + (sc > 1 ? 's' : '') + '</span>' : '';
  badge += collectSegmentFileEditBadges(all);
  var range = '<span class="al-range">[L' + (all[0] + 1) + '–' + (all[all.length - 1] + 1) + ']</span>';
  var html = '<div class="al-seg" data-alidx="' + (seg.idx >= 0 ? seg.idx : all[0]) + '">';
  html += '<span class="al-toggle">[+]</span>' + label + badge + range + '</div>';
  html += '<div class="al-children" style="display:none">';
  for (var i = 0; i < all.length; i++) { html += renderJsonlLineRow(all[i]); }
  html += '</div>';
  return html;
}

function renderAllSegmentsToHtml(segs) {
  var html = '';
  for (var s = 0; s < segs.length; s++) { html += renderConversationSegment(segs[s]); }
  return html;
}

function renderRewindBranch(label, cls, segs, open) {
  var html = '<div class="al-branch-hdr">';
  html += '<span class="al-toggle">[' + (open ? '-' : '+') + ']</span>';
  html += '<span class="' + cls + '">' + label + '</span></div>';
  html += '<div class="al-children' + (cls.indexOf('inactive') >= 0 ? ' al-inactive' : '') + '"';
  html += ' style="display:' + (open ? 'block' : 'none') + '">';
  html += renderAllSegmentsToHtml(segs) + '</div>';
  return html;
}

// ─── Main render ──────────────────────────────────────────────────────────────

export function renderAllLines() {
  var el = document.getElementById(state.branchViewId || 'step-list');
  if (!state.parsedLines || state.parsedLines.length === 0) {
    el.innerHTML = '<div class="empty-state">No JSONL data loaded.</div>';
    return;
  }
  if (!state.selectedFile) {
    el.innerHTML = '<div class="empty-state">Select a file to see which lines are reconstruction steps.</div>';
    renderAllLinesFlat(el);
    return;
  }
  var segs = buildConversationSegments();
  var rwSegs = [];
  for (var s = 0; s < segs.length; s++) {
    if (segs[s].rw) { rwSegs.push(s); }
  }
  if (rwSegs.length === 0) {
    el.innerHTML = renderAllSegmentsToHtml(segs);
    return;
  }
  el.innerHTML = renderSegmentsWithRewindBranches(segs, rwSegs);
}

function renderAllLinesFlat(el) {
  var segs = buildConversationSegments();
  el.innerHTML = renderAllSegmentsToHtml(segs);
}

function renderSegmentsWithRewindBranches(segs, rwSegs) {
  var html = '';
  var cursor = 0;
  var bn = 0;
  for (var b = 0; b < rwSegs.length; b++) {
    var rwIdx = rwSegs[b];
    var rw = segs[rwIdx].rw;
    var fork = 0;
    for (var f = 0; f < rwIdx; f++) {
      if (segs[f].idx >= 0 && segs[f].idx <= rw.parentLine) { fork = f; }
    }
    if (fork >= cursor) {
      html += renderAllSegmentsToHtml(segs.slice(cursor, fork + 1));
      cursor = fork + 1;
    }
    var old = segs.slice(cursor, rwIdx);
    var nextRw = b + 1 < rwSegs.length ? rwSegs[b + 1] : segs.length;
    var active = segs.slice(rwIdx, nextRw);
    bn++;
    var rwLabel = rw.classification === 'code-restoration' ? 'code restored' : 'conversation only';
    html += '<div class="al-branch-pt">Rewind — ' + rwLabel + '</div>';
    if (old.length > 0) {
      html += renderRewindBranch('old branch (' + old.length + ' turns)', 'al-br-inactive', old, false);
    }
    html += renderRewindBranch('active branch (' + active.length + ' turns)', 'al-br-active', active, true);
    cursor = nextRw;
  }
  if (cursor < segs.length) { html += renderAllSegmentsToHtml(segs.slice(cursor)); }
  return html;
}

// ─── Event handling ───────────────────────────────────────────────────────────

function showRawInspect(lineIdx) {
  var obj = state.parsedLines[lineIdx];
  var actualEl = document.getElementById('tab-actual');
  var jsonEl = document.getElementById('json-inspector-content');
  if (obj && obj.toolUseResult && obj.toolUseResult.filePath) {
    var content = obj.toolUseResult.originalFile || obj.toolUseResult.content || '';
    actualEl.innerHTML = '<div class="source-label">from toolUseResult</div><pre>' + renderFileContent(content) + '</pre>';
  } else {
    actualEl.innerHTML = '<div class="no-data">Line ' + (lineIdx + 1) + ' (not a reconstruction step)</div>';
  }
  var pretty = obj ? JSON.stringify(obj, null, 4) : '(parse error)';
  jsonEl.innerHTML = highlightJsonSyntax(pretty);
  document.getElementById('step-info').textContent = 'Line ' + (lineIdx + 1) + ' / ' + state.parsedLines.length;
}

function handleToggle(toggle) {
  var parent = toggle.closest('.al-seg, .al-branch-hdr');
  if (!parent) { return; }
  var children = parent.nextElementSibling;
  if (!children || !children.classList.contains('al-children')) { return; }
  var open = children.style.display !== 'none';
  children.style.display = open ? 'none' : 'block';
  toggle.textContent = open ? '[+]' : '[-]';
}

function handleRowClick(row, containerId, onStepClick, onNonStepClick) {
  var lineIdx = parseInt(row.dataset.alidx, 10);
  if (isNaN(lineIdx)) { return; }
  var container = document.getElementById(containerId);
  var rows = container.querySelectorAll('.al-row');
  for (var i = 0; i < rows.length; i++) { rows[i].classList.remove('al-active'); }
  row.classList.add('al-active');
  if (isStepLine(lineIdx)) {
    if (onStepClick) { onStepClick(state.stepLines[lineIdx]); }
    return;
  }
  if (onNonStepClick) { onNonStepClick(lineIdx); }
  else { showRawInspect(lineIdx); }
}

export function bindBranchViewEvents(containerId, onStepClick, onNonStepClick) {
  var el = document.getElementById(containerId);
  if (!el) { return; }
  el.addEventListener('click', function(e) {
    var toggle = e.target.closest('.al-toggle');
    if (toggle) { handleToggle(toggle); return; }
    var row = e.target.closest('.al-row');
    if (row) { handleRowClick(row, containerId, onStepClick, onNonStepClick); }
  });
}
