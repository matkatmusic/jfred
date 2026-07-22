// Reusable JSON inspector component.
// Shared by JSONL-tree-viewer and JFReD.
// Provides HTML escaping, syntax highlighting, and jump link rendering.

function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function highlightJsonSyntax(json) {
  var re = /("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?)/g;
  return json.replace(re, function(m) {
    var c = 'json-number';
    if (/^"/.test(m)) { c = /:$/.test(m) ? 'json-key' : 'json-string'; }
    else if (/true|false/.test(m)) { c = 'json-boolean'; }
    else if (/null/.test(m)) { c = 'json-null'; }
    return '<span class="' + c + '">' + escapeHtml(m) + '</span>';
  });
}

function findFirstNonSelf(targets, selfIdx) {
  for (var t = 0; t < targets.length; t++) {
    if (targets[t] !== selfIdx) { return targets[t]; }
  }
  return -1;
}

function replaceToolIds(html, toolIdMap, selfIdx) {
  return html.replace(/&quot;(toolu_[A-Za-z0-9_]+)&quot;/g, function(full, toolId) {
    var targets = toolIdMap[toolId];
    if (!targets) { return full; }
    var target = findFirstNonSelf(targets, selfIdx);
    if (target < 0) { return full; }
    return '&quot;<span class="jump-link" data-jump="' + target + '" title="Jump to line ' + (target + 1) + '">' + toolId + '</span>&quot;';
  });
}

function replaceUuids(html, uuidMap) {
  var re = /&quot;([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})&quot;/g;
  return html.replace(re, function(full, uid) {
    if (uuidMap[uid] === undefined) { return full; }
    return '&quot;<span class="jump-link" data-jump="' + uuidMap[uid] + '" title="Jump to line ' + (uuidMap[uid] + 1) + '">' + uid + '</span>&quot;';
  });
}

function addJumpLinks(html, opts) {
  if (!opts) { return html; }
  var toolIdMap = opts.toolIdMap || {};
  var uuidMap = opts.uuidMap || {};
  var selfIdx = opts.selfIdx !== undefined ? opts.selfIdx : -1;
  html = replaceToolIds(html, toolIdMap, selfIdx);
  html = replaceUuids(html, uuidMap);
  return html;
}

function renderInspector(obj, container, opts) {
  var pretty = obj ? JSON.stringify(obj, null, 4) : '(null)';
  var html = highlightJsonSyntax(pretty);
  if (opts) { html = addJumpLinks(html, opts); }
  container.innerHTML = html;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    escapeHtml: escapeHtml,
    highlightJsonSyntax: highlightJsonSyntax,
    addJumpLinks: addJumpLinks,
    renderInspector: renderInspector
  };
}
