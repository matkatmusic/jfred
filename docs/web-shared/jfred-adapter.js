// JFReD: Adapter bridging unified-reconstruct steps into pane-compatible shape.

import { state } from './jfred-state.js';

function buildAdaptedStep(type, filename, contents, expected, actual, isUser, edit, line, ts, raw) {
  return {
    type: type, filename: filename, contents: contents,
    expectedState: expected, actualState: actual,
    isUserEdit: isUser, edit: edit || { content: contents },
    jsonl: { line: line }, timestamp: ts, _raw: raw
  };
}

function detectGroundTruth(rawStep) {
  if (rawStep.snapshot !== null) { return rawStep.snapshot; }
  if (rawStep.originalFile !== null) { return rawStep.originalFile; }
  if (rawStep.readResult !== null) { return rawStep.readResult; }
  if (rawStep.bashReadResult !== null) { return rawStep.bashReadResult; }
  return null;
}

function applyStepToContent(content, rawStep) {
  if (rawStep.snapshot !== null) { return rawStep.snapshot; }
  if (rawStep.originalFile !== null && rawStep.edit) {
    return applySingleEdit(rawStep.edit, rawStep.originalFile);
  }
  if (rawStep.readResult !== null) { return rawStep.readResult; }
  if (rawStep.bashReadResult !== null) { return rawStep.bashReadResult; }
  if (rawStep.structuredPatch) { return applyPatchToState(content, rawStep.structuredPatch); }
  if (rawStep.edit) { return applySingleEdit(rawStep.edit, content); }
  return content;
}

function emitDriftStep(steps, groundTruth, content, targetFile, rawStep) {
  var step = buildAdaptedStep(
    'edit', targetFile, groundTruth, content, groundTruth,
    true, { content: groundTruth }, rawStep.line, rawStep.timestamp, null
  );
  steps.push(step);
}

function emitAgentStep(steps, newContent, expected, groundTruth, targetFile, rawStep) {
  var editType = (rawStep.edit && rawStep.edit.type) ? rawStep.edit.type : 'update';
  var step = buildAdaptedStep(
    editType, targetFile, newContent, expected, groundTruth,
    false, rawStep.edit || { content: newContent },
    rawStep.line, rawStep.timestamp, rawStep
  );
  steps.push(step);
}

export function adaptUnifiedSteps(jsonlText, targetFile) {
  var rawSteps = extractStepsFromSingleJSONL(jsonlText, targetFile, 'browser');
  var rewinds = analyzeJSONL(jsonlText).rewinds;
  var content = '';
  var steps = [];
  var stepLines = {};

  for (var i = 0; i < rawSteps.length; i++) {
    if (isLineIgnoredByRewind(rawSteps[i].line, rewinds)) { continue; }
    var expected = content;
    var groundTruth = detectGroundTruth(rawSteps[i]);

    if (groundTruth !== null && groundTruth !== content) {
      emitDriftStep(steps, groundTruth, content, targetFile, rawSteps[i]);
      content = groundTruth;
      expected = content;
    }

    var newContent = applyStepToContent(content, rawSteps[i]);
    emitAgentStep(steps, newContent, expected, groundTruth, targetFile, rawSteps[i]);
    stepLines[rawSteps[i].line] = steps.length - 1;
    content = newContent;
  }

  return { steps: steps, stepLines: stepLines };
}
