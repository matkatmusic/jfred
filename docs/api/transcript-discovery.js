// Which JSONL transcripts exist / which reference a file.
// Home of project-folder discovery, transcript enumeration/loading, the
// referencing-transcript lookup, and folder grouping. Node-only by nature
// (every export walks the filesystem).
var fs, path;
var collectTouches, buildLineageGraph, resolveAliases, gatherAllOps;
if (typeof module !== 'undefined' && typeof require === 'function') {
  fs = require('fs');
  path = require('path');
  var lineage = require('./file-historical-lineage');
var scriptDetection = require('./script-run-detection');
  collectTouches = lineage.collectTouches;
  buildLineageGraph = lineage.buildLineageGraph;
  resolveAliases = lineage.resolveAliases;
  gatherAllOps = lineage.gatherAllOps;
}

// ─── Project discovery ──────────────────────────────────────────────────────

// Scan a projects directory for subdirectories containing JSONL files.
// Claude Code stores transcripts in folders named after the working directory
// (e.g., -Users-matkatmusicllc-Programming-jot/). Each folder is one "project"
// containing all JSONL sessions for that working directory.
function discoverProjects(projectsDir) {
  var entries = fs.readdirSync(projectsDir);
  var projects = [];
  for (var i = 0; i < entries.length; i++) {
    var full = path.join(projectsDir, entries[i]);
    if (!fs.statSync(full).isDirectory()) { continue; }
    var jsonls = fs.readdirSync(full).filter(function(f) { return f.endsWith('.jsonl'); });
    if (jsonls.length > 0) { projects.push({ name: entries[i], dir: full, jsonlCount: jsonls.length }); }
  }
  return projects;
}

// Convert a Claude projects folder name back to the original filesystem path.
// Claude encodes paths by replacing / with - and prepending -, so
// "-Users-matkatmusicllc-Programming-jot" becomes "/Users/matkatmusicllc/Programming/jot".
function extractCwdFromFolderName(folderName) {
  return folderName.replace(/^-/, '/').replace(/-/g, '/');
}

// ─── JSONL enumeration ──────────────────────────────────────────────────────

// Flat list of absolute .jsonl paths under every project folder in projectsDir.
function enumerateJsonlFiles(projectsDir) {
  var projects = discoverProjects(projectsDir);
  var files = [];
  for (var p = 0; p < projects.length; p++) {
    var entries = fs.readdirSync(projects[p].dir);
    for (var e = 0; e < entries.length; e++) {
      if (!entries[e].endsWith('.jsonl')) { continue; }
      files.push(path.join(projects[p].dir, entries[e]));
    }
  }
  return files;
}

// ─── Core two-pass engine ───────────────────────────────────────────────────

// The earliest line index in a JSONL whose touch matches the alias set, or
// Infinity when nothing matches. Orders results deterministically.
function findFirstMatchingTouchLine(touches, aliases) {
  var best = Infinity;
  for (var i = 0; i < touches.length; i++) {
    if (!aliases.has(touches[i].path)) { continue; }
    if (touches[i].line >= best) { continue; }
    best = touches[i].line;
  }
  return best;
}

// Script runs recorded in one transcript text (for the discovery bridge). A script
// write leaves no touch, so detecting runs here lets gatherEventsForAliases reach the
// files a run rewrote even though they are never "referenced" by a touch.
function detectRunsInText(text) {
  var lines = text.split('\n');
  var parsed = [];
  for (var i = 0; i < lines.length; i++) {
    try { parsed.push(JSON.parse(lines[i])); } catch (e) { parsed.push(null); }
  }
  return scriptDetection.detectScriptRuns(parsed);
}

// Pass 1: collect touches + ops + scriptRuns for every JSONL once, caching the result.
function collectAllJsonls(jsonlFiles) {
  var cache = [];
  for (var i = 0; i < jsonlFiles.length; i++) {
    var text = fs.readFileSync(jsonlFiles[i], 'utf8');
    var collected = collectTouches(text);
    cache.push({ file: jsonlFiles[i], touches: collected.touches, ops: collected.ops, scriptRuns: detectRunsInText(text) });
  }
  return cache;
}

// Compare two match entries: by first matching line, then by file path.
function compareMatches(a, b) {
  if (a.firstLine !== b.firstLine) { return a.firstLine - b.firstLine; }
  return a.file < b.file ? -1 : (a.file > b.file ? 1 : 0);
}

// Pass 2: select cached JSONLs that touched any alias path, sorted by first match.
function selectReferencing(cache, aliases) {
  var matches = [];
  for (var i = 0; i < cache.length; i++) {
    var firstLine = findFirstMatchingTouchLine(cache[i].touches, aliases);
    if (firstLine === Infinity) { continue; }
    matches.push({ file: cache[i].file, firstLine: firstLine });
  }
  matches.sort(compareMatches);
  return matches.map(function (m) { return m.file; });
}

// The one-and-only disk read + JSON.parse of all JSONL files in the projects
// folder. Callers that loop over many files build this once and pass it to
// findReferencingJsonls so the transcripts are never re-read per file.
function loadAllJsonlFilesInProjectsFolder(projectsDir) {
  return collectAllJsonls(enumerateJsonlFiles(projectsDir));
}

// Find every JSONL transcript that touched any of targetPaths (or a lineage
// alias of them). Returns a sorted referencedIn list. Optional cache: pass
// loadAllJsonlFilesInProjectsFolder(projectsDir) to reuse one scan.
function findReferencingJsonls(targetPaths, projectsDir, cache) {
  cache = cache || loadAllJsonlFilesInProjectsFolder(projectsDir);
  var graph = buildLineageGraph(gatherAllOps(cache));
  var aliases = resolveAliases(targetPaths, graph);
  return selectReferencing(cache, aliases);
}

// ─── Folder grouping ────────────────────────────────────────────────────────

// Group the loaded transcripts by their containing project folder:
// { folderDir: [transcriptPath, ...] } in load order.
function groupFilesByFolder(allJsonlFiles) {
  var filesByFolder = {};
  for (var i = 0; i < allJsonlFiles.length; i++) {
    var folder = path.dirname(allJsonlFiles[i].file);
    if (!filesByFolder[folder]) { filesByFolder[folder] = []; }
    filesByFolder[folder].push(allJsonlFiles[i].file);
  }
  return filesByFolder;
}

// ─── Exports ────────────────────────────────────────────────────────────────

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    discoverProjects: discoverProjects,
    extractCwdFromFolderName: extractCwdFromFolderName,
    enumerateJsonlFiles: enumerateJsonlFiles,
    collectAllJsonls: collectAllJsonls,
    loadAllJsonlFilesInProjectsFolder: loadAllJsonlFilesInProjectsFolder,
    findReferencingJsonls: findReferencingJsonls,
    groupFilesByFolder: groupFilesByFolder
  };
}
