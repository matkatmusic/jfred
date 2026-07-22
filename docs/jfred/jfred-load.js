// JFReD: JSONL loading, file picker, dropdown population.

import { state } from '../web-shared/jfred-state.js';
import { renderReconstructionStepRows, showStep } from '../web-shared/jfred-steps.js';
import { resetPanes } from '../web-shared/jfred-panes.js';
import { renderAllLines, bindBranchViewEvents } from '../web-shared/jfred-alllines.js';
import { parseAllLines, groupEditsByFile, buildStepLineMap, openFilePicker, loadFromPath } from '../web-shared/jfred-load-helpers.js';

function populateFileSelect(fileMap) {
  var sel = document.getElementById('file-select');
  var paths = Object.keys(fileMap).sort();
  sel.innerHTML = '<option value="">-- select file (' + paths.length + ' files) --</option>';
  for (var i = 0; i < paths.length; i++) {
    var opt = document.createElement('option');
    opt.value = paths[i];
    var basename = paths[i].split('/').pop();
    opt.textContent = basename + ' (' + fileMap[paths[i]].length + ' edits)';
    opt.title = paths[i];
    sel.appendChild(opt);
  }
  sel.disabled = false;
}

function onLoad(text, filePath) {
  state.jsonlText = text;
  state.allEdits = extractEditsFromJSONL(text);
  state.fileMap = groupEditsByFile(state.allEdits);
  state.parsedLines = parseAllLines(text);
  state.rewinds = analyzeJSONL(text).rewinds;
  populateFileSelect(state.fileMap);
  document.getElementById('step-info').textContent = 'Loaded: ' + (filePath || '').split('/').pop();
  document.getElementById('step-list').innerHTML = '<div class="empty-state">Select a file from the dropdown.</div>';
  document.getElementById('view-toggle').disabled = false;
  resetPanes();
}

function selectFile(filePath) {
  if (!filePath || !state.fileMap[filePath]) { return; }
  state.selectedFile = filePath;
  var fileEdits = state.fileMap[filePath];
  state.steps = buildFileStateHistory(fileEdits);
  state.stepLines = buildStepLineMap(state.steps);
  state.currentStep = state.steps.length > 0 ? 0 : -1;
  if (state.viewMode === 'alllines') { renderAllLines(); }
  else { renderReconstructionStepRows(); }
  if (state.currentStep >= 0) { showStep(0); }
}

// ─── Event wiring ─────────────────────────────────────────────────────────────

document.getElementById('open-btn').addEventListener('click', function() {
  openFilePicker(onLoad, 'jfred-picker');
});

document.getElementById('load-path-btn').addEventListener('click', function() {
  loadFromPath(document.getElementById('path-input').value.trim(), onLoad);
});

document.getElementById('path-input').addEventListener('keydown', function(e) {
  if (e.key === 'Enter') { loadFromPath(this.value.trim(), onLoad); }
});

document.getElementById('file-select').addEventListener('change', function() {
  selectFile(this.value);
});

document.getElementById('view-toggle').addEventListener('click', function() {
  state.viewMode = state.viewMode === 'steps' ? 'alllines' : 'steps';
  this.textContent = state.viewMode === 'steps' ? 'All Lines' : 'Steps Only';
  this.classList.toggle('active', state.viewMode === 'alllines');
  if (state.viewMode === 'alllines') { renderAllLines(); }
  else { renderReconstructionStepRows(); }
});

bindBranchViewEvents('step-list', showStep, null);

(function() {
  var params = new URLSearchParams(window.location.search);
  var fileUrl = params.get('file');
  if (!fileUrl) { return; }
  fileUrl = fileUrl.replace(/^["']|["']$/g, '');
  if (!fileUrl) { return; }
  document.getElementById('path-input').value = fileUrl;
  document.getElementById('path-bar').classList.add('visible');
  loadFromPath(fileUrl, onLoad);
})();
