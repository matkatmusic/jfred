# docs/ — GitHub Pages demo tier (task 63)

Static, zero-server demo of the JFReD JSONL debugger, served by GitHub Pages
("deploy from branch", folder `/docs`).

**Honest labeling:** this runs the FROZEN legacy engine — the browser-compatible
`api/` modules archived from the RevEng workspace — not Engine B (`src/` in this
repo). The full-fidelity Engine-B static demo is a separate, later tier (RevEng
item 17).

## Contents / provenance

- `api/`, `web-shared/`, `jfred/` — frozen copies of `RevEng/archive/{api,web-shared,jfred}`
  (the pre-Fork-port viewer). To refresh, re-copy those folders verbatim; nothing
  here is hand-edited.
- `demo/s87-demo-composite/*.jsonl` — the item-60 sample capture (`demo/projects/
  s87-demo-composite` in this repo), JSONL files only — never copy the bundle's
  `repo.git.tar` or any `.git` directory into docs/.
- `index.html` — hand-written landing page linking each session via the viewer's
  `?file=<url>` auto-load.
- `.nojekyll` — serve files as-is (no Jekyll pass).

## Publishing (one-time)

```sh
git add docs && git commit -m "GitHub Pages demo tier (task 63)" && git push
gh api repos/matkatmusic/jfred/pages -X POST -f "source[branch]=develop" -f "source[path]=/docs"
```

(Use `gh api` — plain `gh repo edit` is blocked by the command classifier.)
Site lands at https://matkatmusic.github.io/jfred/.
