// Shared filter bar: field-based chips, search, and match navigation.

import { state } from './jfred-state.js';

var PRESET_FIELDS = [
  'originalFile', 'structuredPatch', 'old_string', 'new_string',
  'oldString', 'newString', 'tool_use', 'tool_result', 'toolUseResult',
  'thinking', 'isSidechain'
];

var fieldIndex = {};
var activeFilter = null;
var activeFilterMatches = [];
var activeFilterPos = -1;
var containerIds = { bar: 'filter-bar', search: 'filter-search', pos: 'filter-pos', stats: 'file-stats' };

export function configureFilter(ids) {
  if (ids.bar) { containerIds.bar = ids.bar; }
  if (ids.search) { containerIds.search = ids.search; }
  if (ids.pos) { containerIds.pos = ids.pos; }
  if (ids.stats) { containerIds.stats = ids.stats; }
}

function buildJsonFieldToJsonlLineNumberMap() {
  fieldIndex = {};
  for (var i = 0; i < state.parsedLines.length; i++) {
    var obj = state.parsedLines[i];
    if (!obj) { continue; }
    addObjectToJsonFieldToJsonlLineNumberMap(obj, i);
  }
}

function addObjectToJsonFieldToJsonlLineNumberMap(obj, lineIdx) {
  var keys = Object.keys(obj);
  for (var k = 0; k < keys.length; k++) {
    if (!fieldIndex[keys[k]]) { fieldIndex[keys[k]] = []; }
    fieldIndex[keys[k]].push(lineIdx);
    var val = obj[keys[k]];
    if (val && typeof val === 'object' && !Array.isArray(val)) {
      addObjectToJsonFieldToJsonlLineNumberMap(val, lineIdx);
    }
  }
}

function buildFilterBarChips() {
  var bar = document.getElementById(containerIds.bar);
  var search = document.getElementById(containerIds.search);
  if (!bar || !search) { return; }
  var old = bar.querySelectorAll('.filter-chip');
  for (var i = old.length - 1; i >= 0; i--) { bar.removeChild(old[i]); }

  for (var p = 0; p < PRESET_FIELDS.length; p++) {
    var field = PRESET_FIELDS[p];
    var count = fieldIndex[field] ? fieldIndex[field].length : 0;
    var chip = document.createElement('button');
    chip.className = 'filter-chip';
    chip.dataset.field = field;
    chip.innerHTML = escapeHtml(field) + '<span class="chip-count' + (count > 0 ? ' has-matches' : '') + '">' + count + '</span>';
    if (count === 0) { chip.style.opacity = '0.35'; }
    bar.insertBefore(chip, search);
  }
  activeFilter = null;
  activeFilterMatches = [];
  activeFilterPos = -1;
  var posEl = document.getElementById(containerIds.pos);
  if (posEl) { posEl.textContent = ''; }
  bar.classList.add('visible');
}

export function activateFilter(field) {
  var matches = fieldIndex[field] || [];
  if (matches.length === 0) { return; }
  activeFilter = field;
  activeFilterMatches = matches;
  activeFilterPos = 0;

  var chips = document.querySelectorAll('.filter-chip');
  for (var i = 0; i < chips.length; i++) {
    chips[i].classList.toggle('active', chips[i].dataset.field === field);
  }
  updateFilterPos();
  scrollToMatch();
}

function updateFilterPos() {
  var el = document.getElementById(containerIds.pos);
  if (!el) { return; }
  if (activeFilterMatches.length === 0) { el.textContent = ''; return; }
  el.textContent = (activeFilterPos + 1) + '/' + activeFilterMatches.length;
}

function scrollToMatch() {
  if (activeFilterPos < 0) { return; }
  var lineIdx = activeFilterMatches[activeFilterPos];
  var row = document.querySelector('[data-alidx="' + lineIdx + '"]');
  if (row) { row.scrollIntoView({ block: 'nearest' }); row.click(); }
}

export function selectNextMatch() {
  if (activeFilterMatches.length === 0) { return; }
  activeFilterPos = (activeFilterPos + 1) % activeFilterMatches.length;
  updateFilterPos();
  scrollToMatch();
}

export function selectPrevMatch() {
  if (activeFilterMatches.length === 0) { return; }
  activeFilterPos = (activeFilterPos - 1 + activeFilterMatches.length) % activeFilterMatches.length;
  updateFilterPos();
  scrollToMatch();
}

export function getActiveFilter() { return activeFilter; }

export function onJsonlLoaded() {
  buildJsonFieldToJsonlLineNumberMap();
  buildFilterBarChips();
  var stats = document.getElementById(containerIds.stats);
  if (!stats) { return; }
  var lines = state.parsedLines.length;
  var rewinds = state.rewinds.length;
  stats.textContent = lines + ' lines, ' + rewinds + ' rewind' + (rewinds !== 1 ? 's' : '');
}

export function bindFilterEvents() {
  var bar = document.getElementById(containerIds.bar);
  if (!bar) { return; }

  bar.addEventListener('click', function(e) {
    var chip = e.target.closest('.filter-chip');
    if (!chip) { return; }
    var field = chip.dataset.field;
    if (activeFilter === field) { selectNextMatch(); return; }
    activateFilter(field);
  });

  var searchEl = document.getElementById(containerIds.search);
  if (searchEl) {
    searchEl.addEventListener('keydown', function(e) {
      if (e.key !== 'Enter') { return; }
      var field = this.value.trim();
      if (!field) { return; }
      activateFilter(field);
    });
  }

  document.addEventListener('keydown', function(e) {
    if (!activeFilter) { return; }
    if (e.target.tagName === 'INPUT') { return; }
    if (e.key === 'n') { selectNextMatch(); e.preventDefault(); }
    if (e.key === 'N') { selectPrevMatch(); e.preventDefault(); }
  });
}
