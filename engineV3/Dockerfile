FROM node:26-slim
# Old install line, before tmux was added for the recorded tmux calls:
#     && apt-get install -y --no-install-recommends git ripgrep fd-find sd jq curl python3 python-is-python3 python3-pytest procps lsof parallel zsh \
# Old install line, before chromium was added for the recorded bun scripts that drive headless Chrome:
#     && apt-get install -y --no-install-recommends git ripgrep fd-find sd jq curl python3 python-is-python3 python3-pytest procps lsof parallel zsh tmux \
# Old install line, before file, bc, xxd and poppler-utils (pdftotext) were added for recorded calls:
#     && apt-get install -y --no-install-recommends git ripgrep fd-find sd jq curl python3 python-is-python3 python3-pytest procps lsof parallel zsh tmux chromium \
RUN apt-get update \
    && apt-get install -y --no-install-recommends git ripgrep fd-find sd jq curl python3 python-is-python3 python3-pytest procps lsof parallel zsh tmux chromium file bc xxd poppler-utils \
    && rm -rf /var/lib/apt/lists/* \
    && git config --system safe.directory '*' \
    && git config --system user.name "Matkat Music LLC" \
    && git config --system user.email "matkatmusic@gmail.com" \
    && ln -s /usr/bin/fdfind /usr/local/bin/fd
# 85 files on the Mac are mode 600, so --chmod makes everything readable by all and not writable by group or others
COPY --chmod=a+rX,go-w --from=playwrightcache / /Users/matkatmusicllc/Library/Caches/ms-playwright/
COPY --from=oven/bun:1.4.3 /usr/local/bin/bun /usr/local/bin/bun
RUN ln -s /usr/local/bin/bun /usr/local/bin/bunx
RUN npm install -g tsx@4.23.1
ENV NODE_OPTIONS=--max-old-space-size=10000
ENV BUN_INSTALL_CACHE_DIR=/Users/matkatmusicllc/.bun/install/cache
ENV NPM_CONFIG_CACHE=/npm-cache
COPY --from=packageseed / /packageseed/
RUN set -e; \
    for seedFolder in /packageseed/*/; do \
        [ -d "$seedFolder" ] || continue; \
        if [ -f "$seedFolder/bun.lock" ]; then \
            (cd "$seedFolder" && bun install --frozen-lockfile); \
        fi; \
        if [ -f "$seedFolder/package-lock.json" ]; then \
            (cd "$seedFolder" && npm ci); \
        fi; \
    done; \
    rm -rf /packageseed; \
    mkdir -p /Users/matkatmusicllc/.bun /npm-cache; \
    chmod -R a+rX /Users/matkatmusicllc/.bun /npm-cache
# Mac md5: "MD5 (f) = hash" per file, -q prints only the hash, no file hashes stdin.
COPY --chmod=755 <<'MD5_SCRIPT' /usr/local/bin/md5
#!/bin/sh
set -e
realMd5sum="${MD5_STAND_IN_REAL_MD5SUM:-md5sum}"
if [ $# -eq 0 ]; then
    stdinHash="$("$realMd5sum")"
    printf '%s\n' "${stdinHash%% *}"
    exit 0
fi
printOnlyHash=no
if [ "$1" = "-q" ]; then
    printOnlyHash=yes
    shift
    if [ $# -eq 0 ]; then
        echo "md5 stand-in: 'md5 -q' with no file is not translated" >&2
        exit 1
    fi
fi
case "$1" in
    -*)
        echo "md5 stand-in: 'md5 $*' is not translated; only 'md5 [-q] <files>' and 'md5' on stdin are" >&2
        exit 1
        ;;
esac
exitStatus=0
for file in "$@"; do
    if [ -f "$file" ]; then
        # printf 'MD5 (%s) = %s\n' "$file" "$(md5sum "$file" | cut -d' ' -f1)"
        fileHash="$("$realMd5sum" "$file")"
        if [ "$printOnlyHash" = yes ]; then
            printf '%s\n' "${fileHash%% *}"
        else
            printf 'MD5 (%s) = %s\n' "$file" "${fileHash%% *}"
        fi
    else
        echo "md5: $file: No such file or directory" >&2
        exitStatus=1
    fi
done
exit $exitStatus
MD5_SCRIPT
# On the Mac, pkill -f and pgrep -f do not select the shell that holds the pattern text; on Linux they do, unless told to ignore their ancestors.
COPY --chmod=755 <<'PKILL_SCRIPT' /usr/local/bin/pkill
#!/bin/sh
exec /usr/bin/pkill --ignore-ancestors "$@"
PKILL_SCRIPT
COPY --chmod=755 <<'PGREP_SCRIPT' /usr/local/bin/pgrep
#!/bin/sh
exec /usr/bin/pgrep --ignore-ancestors "$@"
PGREP_SCRIPT
# BSD sed reads the word after -i as the backup suffix; GNU sed reads -i '' as -i plus the script ''.
COPY --chmod=755 <<'SED_SCRIPT' /usr/local/bin/sed
#!/bin/sh
realSed="${SED_STAND_IN_REAL_SED:-/usr/bin/sed}"
if [ "$1" = "-i" ]; then
    if [ $# -ge 2 ]; then
        if [ -z "$2" ]; then
            shift 2
            exec "$realSed" -i "$@"
        fi
    fi
    echo "sed stand-in: on the Mac 'sed $*' takes the word after -i as a backup suffix and edits nothing; only -i '' is translated" >&2
    exit 1
fi
for argument in "$@"; do
    if [ "$argument" = "-i" ]; then
        echo "sed stand-in: 'sed $*' has -i after other arguments; only a first -i '' is translated" >&2
        exit 1
    fi
done
exec "$realSed" "$@"
SED_SCRIPT
# BSD stat -f <format> prints file facts; GNU stat -f means "file system", so each recorded specifier is asked of GNU stat.
COPY --chmod=755 <<'STAT_SCRIPT' /usr/local/bin/stat
#!/bin/sh
set -e
realStat="${STAT_STAND_IN_REAL_STAT:-/usr/bin/stat}"
realDate="${STAT_STAND_IN_REAL_DATE:-/usr/bin/date}"
if [ "$1" != "-f" ]; then
    for argument in "$@"; do
        if [ "$argument" = "-f" ]; then
            echo "stat stand-in: 'stat $*' has -f after other arguments; only 'stat -f <format> [-t <time format>] <files>' is translated" >&2
            exit 1
        fi
    done
    exec "$realStat" "$@"
fi
bsdFormat="$2"
shift 2
timeFormat="%b %e %H:%M:%S %Y"
if [ "$1" = "-t" ]; then
    timeFormat="$2"
    shift 2
fi
for argument in "$@"; do
    case "$argument" in
        -*)
            echo "stat stand-in: flag '$argument' in 'stat -f' is not translated" >&2
            exit 1
            ;;
    esac
done
exitStatus=0
for file in "$@"; do
    if [ ! -e "$file" ]; then
        echo "stat: $file: stat: No such file or directory" >&2
        exitStatus=1
        continue
    fi
    line=""
    rest="$bsdFormat"
    while [ -n "$rest" ]; do
        case "$rest" in
            %Sm*)
                modifiedSeconds="$("$realStat" -c %Y -- "$file")"
                line="$line$("$realDate" -d "@$modifiedSeconds" +"$timeFormat")"
                rest="${rest#%Sm}"
                ;;
            %SB*)
                birthSeconds="$("$realStat" -c %W -- "$file")"
                case "$birthSeconds" in
                    0|-)
                        echo "stat stand-in: GNU stat does not know the birth time of $file" >&2
                        exit 1
                        ;;
                esac
                line="$line$("$realDate" -d "@$birthSeconds" +"$timeFormat")"
                rest="${rest#%SB}"
                ;;
            %m*)
                line="$line$("$realStat" -c %Y -- "$file")"
                rest="${rest#%m}"
                ;;
            %z*)
                line="$line$("$realStat" -c %s -- "$file")"
                rest="${rest#%z}"
                ;;
            %N*)
                line="$line$file"
                rest="${rest#%N}"
                ;;
            %*)
                echo "stat stand-in: BSD stat format '$bsdFormat' has a specifier that is not translated" >&2
                exit 1
                ;;
            *)
                line="$line${rest%"${rest#?}"}"
                rest="${rest#?}"
                ;;
        esac
    done
    printf '%s\n' "$line"
done
exit $exitStatus
STAT_SCRIPT
# Recorded calls only look at the Mac claude program, so they do nothing here (user decision: skip these commands); any other use fails.
COPY --chmod=755 <<'CLAUDE_SCRIPT' /usr/local/bin/claude
#!/bin/sh
case "$1" in
    --version|--help|plugin)
        exit 0
        ;;
esac
echo "claude stand-in: the replay image has no Claude Code program, so 'claude $*' cannot run" >&2
exit 1
CLAUDE_SCRIPT
# Recorded bun scripts start Chrome at its Mac path; COPY cannot write a path with spaces, so printf writes the file.
RUN mkdir -p "/Applications/Google Chrome.app/Contents/MacOS" \
    && printf '#!/bin/sh\nexec chromium --no-sandbox --disable-dev-shm-usage "$@"\n' > "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
    && chmod 755 "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
RUN useradd --no-create-home --home-dir /tmp/replay-home replay \
    && chmod 755 /var/tmp /run/lock \
    && mkdir -p /private \
    && ln -s /tmp /private/tmp
