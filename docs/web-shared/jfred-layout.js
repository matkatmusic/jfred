// JFReD: Resize handle between top and bottom halves.

const handle = document.getElementById('resize-h');
const topHalf = document.querySelector('.top-half');
const bottomHalf = document.querySelector('.bottom-half');
let dragging = false;
let startY = 0;
let startTopH = 0;
let startBotH = 0;

handle.addEventListener('mousedown', function(e) {
  dragging = true;
  startY = e.clientY;
  startTopH = topHalf.offsetHeight;
  startBotH = bottomHalf.offsetHeight;
  document.body.style.userSelect = 'none';
  e.preventDefault();
});

document.addEventListener('mousemove', function(e) {
  if (!dragging) { return; }
  const delta = e.clientY - startY;
  const totalH = startTopH + startBotH;
  const newTopH = Math.max(80, Math.min(totalH - 80, startTopH + delta));
  const newBotH = totalH - newTopH;
  topHalf.style.flex = `0 0 ${newTopH}px`;
  bottomHalf.style.flex = `0 0 ${newBotH}px`;
});

document.addEventListener('mouseup', function() {
  if (!dragging) { return; }
  dragging = false;
  document.body.style.userSelect = '';
});

// ─── Vertical resize handles (unified view column widths) ────────────────────

function setupPaneResize(handleId, leftId, rightId) {
  var vHandle = document.getElementById(handleId);
  if (!vHandle) { return; }
  var leftPane = document.getElementById(leftId);
  var rightPane = document.getElementById(rightId);
  var vDragging = false;
  var vStartX = 0;
  var vStartLeftW = 0;
  var vStartRightW = 0;

  vHandle.addEventListener('mousedown', function(e) {
    vDragging = true;
    vStartX = e.clientX;
    vStartLeftW = leftPane.offsetWidth;
    vStartRightW = rightPane.offsetWidth;
    document.body.style.userSelect = 'none';
    e.preventDefault();
  });

  document.addEventListener('mousemove', function(e) {
    if (!vDragging) { return; }
    var delta = e.clientX - vStartX;
    var total = vStartLeftW + vStartRightW;
    var newLeft = Math.max(120, Math.min(total - 120, vStartLeftW + delta));
    var newRight = total - newLeft;
    leftPane.style.flex = '0 0 ' + newLeft + 'px';
    rightPane.style.flex = '0 0 ' + newRight + 'px';
  });

  document.addEventListener('mouseup', function() {
    if (!vDragging) { return; }
    vDragging = false;
    document.body.style.userSelect = '';
  });
}

setupPaneResize('resize-v-left', 'branch-view', 'current-state-pane');
setupPaneResize('resize-v-right', 'current-state-pane', 'json-inspector-pane');

// ─── Diff Only toggle ─────────────────────────────────────────────────────────

document.getElementById('diff-only-btn').addEventListener('click', function() {
  const area = document.getElementById('pane-area');
  area.classList.toggle('diff-only');
  this.classList.toggle('active');
});

// ─── Synchronized scrolling across the three bottom panes ─────────────────────

const paneBodies = [
  document.getElementById('prev-body'),
  document.getElementById('computed-body'),
  document.getElementById('next-body')
];
let syncing = false;

function synchronizeScroll(source) {
  if (syncing) { return; }
  syncing = true;
  const top = source.scrollTop;
  for (let i = 0; i < paneBodies.length; i++) {
    if (paneBodies[i] !== source) { paneBodies[i].scrollTop = top; }
  }
  syncing = false;
}

for (let i = 0; i < paneBodies.length; i++) {
  paneBodies[i].addEventListener('scroll', function() { synchronizeScroll(this); });
}
