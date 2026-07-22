// Reusable LCS line-diff engine with inline and side-by-side renderers.
// Shared by JSONL-tree-viewer and JFReD. Moved (Phase 5) from
// common/diff-engine.js, bodies unchanged (renamed to line-diff).

// Private HTML escape for diff rendering (avoids cross-module dependency).
function escapeHtmlEntities(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function buildLongestCommonSubsequenceDiffTable(a, b) {
  var n = a.length, m = b.length;
  var dp = new Array(n + 1);
  for (var i = 0; i <= n; i++) { dp[i] = new Int32Array(m + 1); }
  for (var i = n - 1; i >= 0; i--) {
    for (var j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  return dp;
}

function traceLongestCommonSubsequencePath(a, b, dp) {
  var ops = [], x = 0, y = 0;
  while (x < a.length && y < b.length) {
    if (a[x] === b[y]) { ops.push({ op: 'ctx', text: a[x] }); x++; y++; }
    else if (dp[x + 1][y] >= dp[x][y + 1]) { ops.push({ op: 'del', text: a[x] }); x++; }
    else { ops.push({ op: 'add', text: b[y] }); y++; }
  }
  while (x < a.length) { ops.push({ op: 'del', text: a[x] }); x++; }
  while (y < b.length) { ops.push({ op: 'add', text: b[y] }); y++; }
  return ops;
}

function computeLineDiff(a, b) {
  var dp = buildLongestCommonSubsequenceDiffTable(a, b);
  return traceLongestCommonSubsequencePath(a, b, dp);
}

function renderInlineDiff(ops) {
  var h = '<div class="diff-view"><div class="diff-hunk">';
  for (var i = 0; i < ops.length; i++) {
    var o = ops[i];
    var cls = o.op === 'add' ? 'diff-add' : o.op === 'del' ? 'diff-del' : 'diff-ctx';
    var pfx = o.op === 'add' ? '+' : o.op === 'del' ? '-' : ' ';
    h += '<div class="diff-line ' + cls + '">' + escapeHtmlEntities(pfx + o.text) + '</div>';
  }
  return h + '</div></div>';
}

function collectChanges(ops, start) {
  var dels = [], adds = [], i = start;
  while (i < ops.length && ops[i].op === 'del') { dels.push(ops[i].text); i++; }
  while (i < ops.length && ops[i].op === 'add') { adds.push(ops[i].text); i++; }
  return { dels: dels, adds: adds, next: i };
}

function renderSxsChangeBlock(dels, adds) {
  var h = '';
  var rows = Math.max(dels.length, adds.length);
  for (var r = 0; r < rows; r++) {
    var left = r < dels.length ? '<div class="diff-cell del">' + escapeHtmlEntities('-' + dels[r]) + '</div>' : '<div class="diff-cell empty"></div>';
    var right = r < adds.length ? '<div class="diff-cell add">' + escapeHtmlEntities('+' + adds[r]) + '</div>' : '<div class="diff-cell empty"></div>';
    h += '<div class="diff-sxs-row">' + left + right + '</div>';
  }
  return h;
}

function renderSxsDiff(ops) {
  var h = '<div class="diff-view"><div class="diff-sxs">', i = 0;
  while (i < ops.length) {
    if (ops[i].op === 'ctx') {
      h += '<div class="diff-sxs-row ctx-row"><div class="diff-cell ctx">' + escapeHtmlEntities(' ' + ops[i].text) + '</div></div>';
      i++;
    } else {
      var change = collectChanges(ops, i);
      h += renderSxsChangeBlock(change.dels, change.adds);
      i = change.next;
    }
  }
  return h + '</div></div>';
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    computeLineDiff: computeLineDiff,
    renderInlineDiff: renderInlineDiff,
    renderSxsDiff: renderSxsDiff
  };
}
