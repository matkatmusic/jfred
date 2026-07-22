// JFReD: Step list rendering, tab switching, navigation.

import { state } from './jfred-state.js';
import { updatePanes, renderFileContent } from './jfred-panes.js';

function hasDivergence(step) {
  if (step.actualState === null || step.actualState === undefined) { return false; }
  return step.actualState !== step.expectedState;
}

function deriveStepEditSource(step) {
  return step.isUserEdit ? 'user' : 'toolUseResult';
}

function renderStepRow(step, idx) {
  let classes = 'step-row';
  if (step.isUserEdit) { classes += ' user-edit'; }
  if (hasDivergence(step)) { classes += ' divergent'; }
  const typeCls = `step-type step-type-${step.type}`;
  const src = deriveStepEditSource(step);
  const srcCls = `step-source step-source-${src}`;
  let icon = '<span class="step-icon step-icon-kept">&#9679;</span>';
  if (hasDivergence(step)) { icon = '<span class="step-icon step-icon-diverge">&#9679;</span>'; }
  else if (step.isUserEdit) { icon = '<span class="step-icon step-icon-user">&#9650;</span>'; }
  const lineNum = (step.jsonl && step.jsonl.line !== undefined) ? step.jsonl.line : '';
  const lineHtml = lineNum !== '' ? `<span class="step-line">L${lineNum}</span>` : '';
  return `<div class="${classes}" data-step="${idx}">` +
    `<span class="step-num">${idx + 1}</span>${icon}` +
    `<span class="${typeCls}">${escapeHtml(step.type)}</span>` +
    `<span class="${srcCls}">${escapeHtml(src)}</span>${lineHtml}</div>`;
}

export function renderReconstructionStepRows() {
  const el = document.getElementById('step-list');
  if (state.steps.length === 0) {
    el.innerHTML = '<div class="empty-state">No edits found for this file.</div>';
    return;
  }
  let html = '';
  for (let i = 0; i < state.steps.length; i++) {
    html += renderStepRow(state.steps[i], i);
  }
  el.innerHTML = html;
}

function updateStepInfo() {
  const info = document.getElementById('step-info');
  if (state.steps.length === 0) { info.textContent = 'No steps'; return; }
  info.textContent = `Step ${state.currentStep + 1} / ${state.steps.length}`;
}

function updateInspector() {
  const step = state.steps[state.currentStep];
  if (!step) { return; }
  const actualEl = document.getElementById('tab-actual');
  const hasActual = step.actualState !== null && step.actualState !== undefined;
  const displayContent = hasActual ? step.actualState : step.contents;
  const sourceLabel = hasActual ? 'from originalFile' : 'from computed contents';
  if (displayContent !== null && displayContent !== undefined) {
    actualEl.innerHTML = `<div class="source-label">${sourceLabel}</div><pre>${renderFileContent(displayContent)}</pre>`;
  } else {
    actualEl.innerHTML = '<div class="no-data">(no content available)</div>';
  }
  const jsonEl = document.getElementById('json-inspector-content');
  const inspectObj = {
    type: step.type, filename: step.filename, edit: step.edit,
    isUserEdit: step.isUserEdit, jsonlLine: step.jsonl ? step.jsonl.line : null
  };
  jsonEl.innerHTML = highlightJsonSyntax(JSON.stringify(inspectObj, null, 4));
}

function findNext(type, direction) {
  for (let i = state.currentStep + direction; i >= 0 && i < state.steps.length; i += direction) {
    if (type === 'divergence' && hasDivergence(state.steps[i])) { return i; }
    if (type === 'user' && state.steps[i].isUserEdit) { return i; }
  }
  return -1;
}

function updateNavButtons() {
  document.getElementById('prev-btn').disabled = state.currentStep <= 0;
  document.getElementById('next-btn').disabled = state.currentStep >= state.steps.length - 1;
  document.getElementById('jump-div-btn').disabled = findNext('divergence', 1) < 0;
  document.getElementById('jump-user-btn').disabled = findNext('user', 1) < 0;
}

export function showStep(idx) {
  if (idx < 0 || idx >= state.steps.length) { return; }
  state.currentStep = idx;
  const rows = document.querySelectorAll('.step-row');
  for (let i = 0; i < rows.length; i++) {
    rows[i].classList.toggle('active', parseInt(rows[i].dataset.step, 10) === idx);
  }
  const activeRow = document.querySelector(`.step-row[data-step="${idx}"]`);
  if (activeRow) { activeRow.scrollIntoView({ block: 'nearest' }); }
  updateStepInfo();
  updateInspector();
  updatePanes();
  updateNavButtons();
}

// ─── Event listeners ──────────────────────────────────────────────────────────

function bindClickHandler(id, handler) {
  var el = document.getElementById(id);
  if (el) { el.addEventListener('click', handler); }
}

bindClickHandler('step-list', function(e) {
  var row = e.target.closest('.step-row');
  if (row) { showStep(parseInt(row.dataset.step, 10)); }
});

bindClickHandler('prev-btn', function() {
  if (state.currentStep > 0) { showStep(state.currentStep - 1); }
});

bindClickHandler('next-btn', function() {
  if (state.currentStep < state.steps.length - 1) { showStep(state.currentStep + 1); }
});

bindClickHandler('jump-div-btn', function() {
  var target = findNext('divergence', 1);
  if (target >= 0) { showStep(target); }
});

bindClickHandler('jump-user-btn', function() {
  var target = findNext('user', 1);
  if (target >= 0) { showStep(target); }
});

if (document.getElementById('step-list')) {
  document.addEventListener('keydown', function(e) {
    if (state.steps.length === 0) { return; }
    if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (state.currentStep > 0) { showStep(state.currentStep - 1); }
    }
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      e.preventDefault();
      if (state.currentStep < state.steps.length - 1) { showStep(state.currentStep + 1); }
    }
  });
}
