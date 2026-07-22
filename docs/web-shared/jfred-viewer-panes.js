// Shared viewer pane logic: current state display, inspector, step navigation helpers.

import { state } from './jfred-state.js';
import { renderFileContent, updatePanes } from './jfred-panes.js';

export function updateCurrentState(step, containerId) {
  var el = document.getElementById(containerId || 'current-state-body');
  if (!el) { return; }
  if (!step) { el.innerHTML = '<div class="no-data">(no content)</div>'; return; }
  var content = step.actualState || step.contents;
  var label = step.actualState ? 'from originalFile' : 'from computed contents';
  el.innerHTML = '<div class="source-label">' + label + '</div>' + renderFileContent(content);
}

export function clearCurrentState(containerId) {
  var el = document.getElementById(containerId || 'current-state-body');
  if (el) { el.innerHTML = '<div class="no-data">(no content)</div>'; }
}

export function updateStepInspector(step, containerId) {
  var el = document.getElementById(containerId || 'json-inspector-content');
  if (!el) { return; }
  var data = step._raw ? step._raw : {
    type: step.type, filename: step.filename,
    edit: step.edit, isUserEdit: step.isUserEdit,
    jsonlLine: step.jsonl.line
  };
  el.innerHTML = highlightJsonSyntax(JSON.stringify(data, null, 4));
}

export function updateRawInspector(lineIdx, containerId) {
  var el = document.getElementById(containerId || 'json-inspector-content');
  if (!el) { return; }
  var obj = state.parsedLines[lineIdx];
  var pretty = obj ? JSON.stringify(obj, null, 4) : '(parse error)';
  el.innerHTML = highlightJsonSyntax(pretty);
}

export function findNearestPrevStep(lineIdx) {
  var keys = Object.keys(state.stepLines).map(Number).sort(function(a, b) { return a - b; });
  var best = -1;
  for (var i = 0; i < keys.length; i++) {
    if (keys[i] >= lineIdx) { break; }
    best = state.stepLines[keys[i]];
  }
  return best;
}

export function findNearestNextStep(lineIdx) {
  var keys = Object.keys(state.stepLines).map(Number).sort(function(a, b) { return a - b; });
  for (var i = 0; i < keys.length; i++) {
    if (keys[i] > lineIdx) { return state.stepLines[keys[i]]; }
  }
  return -1;
}

export function showNonStepLine(lineIdx, opts) {
  var stateBodyId = (opts && opts.stateBodyId) || 'current-state-body';
  var inspectorId = (opts && opts.inspectorId) || 'json-inspector-content';
  var stepInfoId = (opts && opts.stepInfoId) || 'step-info';

  state.selectedLineIdx = lineIdx;
  state.nearestPrevStep = findNearestPrevStep(lineIdx);
  state.nearestNextStep = findNearestNextStep(lineIdx);

  var prevStep = state.nearestPrevStep >= 0 ? state.steps[state.nearestPrevStep] : null;
  if (prevStep) { updateCurrentState(prevStep, stateBodyId); }
  else { clearCurrentState(stateBodyId); }

  updateRawInspector(lineIdx, inspectorId);

  var infoEl = document.getElementById(stepInfoId);
  if (infoEl) { infoEl.textContent = 'Line ' + (lineIdx + 1) + ' / ' + state.parsedLines.length; }

  if (prevStep) {
    state.currentStep = state.nearestPrevStep;
    updatePanes();
  }
}
