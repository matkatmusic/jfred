// JFReD: Shared loading helpers used by jfred, unified, and diff viewers.

var PATH_REWRITES = [
  { prefix: '/Users/matkatmusicllc/.claude/projects/', local: '../projects/' },
  { prefix: '/Users/matkatmusicllc/Desktop/claude code src/RevEng/', local: '../' }
];

export function rewritePath(filePath) {
  for (var i = 0; i < PATH_REWRITES.length; i++) {
    var rw = PATH_REWRITES[i];
    if (filePath.indexOf(rw.prefix) === 0) { return rw.local + filePath.slice(rw.prefix.length); }
  }
  return filePath;
}

export function parseAllLines(text) {
  var lines = text.split('\n').filter(Boolean);
  var parsed = [];
  for (var i = 0; i < lines.length; i++) {
    try { parsed.push(JSON.parse(lines[i])); }
    catch (e) { parsed.push(null); }
  }
  return parsed;
}

export function groupEditsByFile(edits) {
  var map = {};
  for (var i = 0; i < edits.length; i++) {
    var fp = edits[i].filePath || edits[i].file || '';
    if (!fp) { continue; }
    if (!map[fp]) { map[fp] = []; }
    map[fp].push(edits[i]);
  }
  return map;
}

export function buildStepLineMap(steps) {
  var map = {};
  for (var i = 0; i < steps.length; i++) {
    if (steps[i].jsonl && steps[i].jsonl.line !== undefined) {
      map[steps[i].jsonl.line] = i;
    }
  }
  return map;
}

export function openFilePicker(onLoad, pickerId) {
  if (!window.showOpenFilePicker) { return; }
  window.showOpenFilePicker({
    id: pickerId || 'jfred-picker',
    types: [{ description: 'JSONL transcripts', accept: { 'application/x-jsonl': ['.jsonl'] } }],
    multiple: false
  }).then(function(handles) {
    return handles[0].getFile();
  }).then(function(file) {
    return file.text().then(function(t) { onLoad(t, file.name); });
  }).catch(function(e) {
    if (e.name !== 'AbortError') { console.error(e); }
  });
}

export function loadFromPath(filePath, onLoad) {
  if (!filePath) { return; }
  var fetchUrl = rewritePath(filePath);
  fetch(fetchUrl).then(function(r) {
    if (!r.ok) { throw new Error('HTTP ' + r.status); }
    return r.text();
  }).then(function(text) {
    onLoad(text, filePath);
  }).catch(function(e) {
    console.error('Failed to load:', e);
  });
}
