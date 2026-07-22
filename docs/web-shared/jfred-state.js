// JFReD: Shared application state.

export const state = {
  jsonlText: '',
  allEdits: [],
  fileMap: {},
  selectedFile: '',
  steps: [],
  currentStep: -1,
  parsedLines: [],
  rewinds: [],
  stepLines: {},
  viewMode: 'steps',
  engine: 'old',
  branchViewId: 'step-list',
  selectedLineIdx: -1,
  nearestPrevStep: -1,
  nearestNextStep: -1,
  baseState: '',
  baseSource: 'empty',
  filterMode: 'all'
};
