// JFReD: Three-pane rendering (Previous | Computed | Next) with divergence highlighting.

import { state } from './jfred-state.js';

function getPrevBody() { return document.getElementById('prev-body'); }
function getComputedBody() { return document.getElementById('computed-body'); }
function getNextBody() { return document.getElementById('next-body'); }
function getPrevBadge() { return document.getElementById('prev-badge'); }
function getComputedBadge() { return document.getElementById('computed-badge'); }
function getNextBadge() { return document.getElementById('next-badge'); }

export function renderFileContent(content) {
  if (!content && content !== '') { return '<span class="no-data">(empty)</span>'; }
  const lines = content.split('\n');
  let html = '';
  for (let i = 0; i < lines.length; i++) {
    html += `<div class="pane-line"><span class="pane-line-num">${i + 1}</span>${escapeHtml(lines[i])}</div>`;
  }
  return html;
}

function renderPlainContent(content, container) {
  if (content === null || content === undefined) {
    container.innerHTML = '<div class="no-data">(no content)</div>';
    return;
  }
  container.innerHTML = `<pre>${renderFileContent(content)}</pre>`;
}

function renderDivergenceCheck(expected, actual, container, badge) {
  if (actual === null || actual === undefined) {
    renderPlainContent(expected, container);
    badge.className = 'pane-badge';
    badge.textContent = '';
    return;
  }
  if (expected === actual) {
    renderPlainContent(expected, container);
    badge.className = 'pane-badge badge-match';
    badge.textContent = 'MATCH';
    return;
  }
  const expectedLines = (expected || '').split('\n');
  const actualLines = (actual || '').split('\n');
  container.innerHTML = renderInlineDiff(computeLineDiff(expectedLines, actualLines));
  badge.className = 'pane-badge badge-mismatch';
  badge.textContent = 'MISMATCH';
}

function renderNextPane() {
  const nextBody = getNextBody();
  const nextBadge = getNextBadge();
  const nextIdx = state.currentStep + 1;
  if (nextIdx < state.steps.length) {
    renderPlainContent(state.steps[nextIdx].expectedState, nextBody);
    nextBadge.className = 'pane-badge';
    nextBadge.textContent = '';
    return;
  }
  nextBody.innerHTML = '<div class="no-data">(last step — on-disk comparison not yet loaded)</div>';
  nextBadge.className = 'pane-badge';
  nextBadge.textContent = '';
}

export function resetPanes() {
  getPrevBody().innerHTML = '<div class="no-data">expectedState</div>';
  getComputedBody().innerHTML = '<div class="no-data">contents</div>';
  getNextBody().innerHTML = '<div class="no-data">next expectedState</div>';
  const badges = [getPrevBadge(), getComputedBadge(), getNextBadge()];
  for (let i = 0; i < badges.length; i++) {
    badges[i].className = 'pane-badge';
    badges[i].textContent = '';
  }
}

export function updatePanes() {
  const step = state.steps[state.currentStep];
  if (!step) { resetPanes(); return; }
  renderDivergenceCheck(step.expectedState, step.actualState, getPrevBody(), getPrevBadge());
  renderPlainContent(step.contents, getComputedBody());
  getComputedBadge().className = 'pane-badge';
  getComputedBadge().textContent = '';
  renderNextPane();
}
