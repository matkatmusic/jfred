FROM node:26-slim
RUN apt-get update \
    && apt-get install -y --no-install-recommends git ripgrep fd-find sd jq curl python3 python-is-python3 python3-pytest procps lsof parallel zsh rsync file \
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
            (cd "$seedFolder" && rm -rf node_modules bun.lock && bun install --minimum-release-age=1); \
        fi; \
        if [ -f "$seedFolder/package-lock.json" ]; then \
            (cd "$seedFolder" && npm ci); \
        fi; \
    done; \
    playwrightScratch=$(mktemp -d); \
    cd "$playwrightScratch"; \
    echo '{"name":"playwrightcache","private":true}' > package.json; \
    for playwrightVersion in 1.54.0 1.58.2 1.63.0; do \
        bun add playwright@$playwrightVersion playwright-core@$playwrightVersion; \
    done; \
    bun add playwright-core --minimum-release-age=$(( $(date +%s) - 1793216156 )); \
    cd /; \
    rm -rf "$playwrightScratch" /packageseed; \
    mkdir -p /Users/matkatmusicllc/.bun /npm-cache; \
    chmod -R a+rwX /Users/matkatmusicllc/.bun /npm-cache
# Recorded `ls ~/.bun/install/cache | rg playwright` (toolu_01Fb9Q45x2wCx4wd2Fqx9syZ) needs the Mac's playwright versions; the last add is the recorded `bun add playwright-core` (toolu_01VKD85mMmS76FR5DM31Prua, 2026-10-28T19:35:56Z = 1793216156) that installed 1.64.1.
# Replaced: chmod -R a+rX /Users/matkatmusicllc/.bun /npm-cache (the bun cache must be writable for the replay user)
# The container has no network, so a recorded bun add or bun install resolves from the package lists saved above, however old they are.
# --minimum-release-age makes it pick the versions that existed at the recorded time (the engine sets REPLAY_RECORDED_AT_EPOCH_SECONDS).
RUN mv /usr/local/bin/bun /usr/local/bin/bun-real && ln -sf /usr/local/bin/bun-real /usr/local/bin/bunx
COPY --chmod=755 <<'BUN_WRAPPER' /usr/local/bin/bun
#!/bin/sh
case "${1:-}" in
    add | install | i)
        subcommand="$1"
        shift
        recordedAge=$(( $(date +%s) - REPLAY_RECORDED_AT_EPOCH_SECONDS ))
        exec /usr/local/bin/bun-real "$subcommand" --prefer-offline --minimum-release-age="$recordedAge" "$@"
        ;;
esac
exec /usr/local/bin/bun-real "$@"
BUN_WRAPPER
COPY --chmod=755 <<'MD5_SCRIPT' /usr/local/bin/md5
#!/bin/sh
exitStatus=0
for file in "$@"; do
    if [ -f "$file" ]; then
        printf 'MD5 (%s) = %s\n' "$file" "$(md5sum "$file" | cut -d' ' -f1)"
    else
        echo "md5: $file: No such file or directory" >&2
        exitStatus=1
    fi
done
exit $exitStatus
MD5_SCRIPT
# The only ifconfig output recorded: ~/.claude/projects/-Users-matkatmusicllc-Programming-typesafe-playground/c7e1c1e2-715b-490c-bb1d-9da5049c03cb/subagents/agent-adf1290ff251a21bf.jsonl line 963.
COPY --chmod=755 <<'IFCONFIG_SCRIPT' /usr/local/bin/ifconfig
#!/bin/sh
printf '\tinet 192.168.1.144 netmask 0xffffff00 broadcast 192.168.1.255\n'
IFCONFIG_SCRIPT
# The replay compares exit codes: BSD stat -f is a format, GNU stat -f is the file system. Recorded calls: 2b1644e3-98c4-41f1-9eb3-c8a54e92ae99.jsonl line 250, 6e01d3f7-e389-41bb-ae21-a9da73263097.jsonl line 336, c6df4977-982a-4d00-8032-b6542fe225f3.jsonl line 106.
COPY --chmod=755 <<'STAT_SCRIPT' /usr/local/bin/stat
#!/bin/sh
if [ "${1:-}" = "-f" ]; then
    case "${2:-}" in
        *%*)
            bsdFormat="$2"
            shift 2
            timeFormat="%b %e %H:%M:%S %Y"
            if [ "${1:-}" = "-t" ]; then
                timeFormat="$2"
                shift 2
            fi
            exitStatus=0
            for file in "$@"; do
                if [ -e "$file" ]; then
                    modifiedTime=$(date -d "@$(/usr/bin/stat -c %Y "$file")" +"$timeFormat")
                    BSD_FORMAT="$bsdFormat" MODIFIED_TIME="$modifiedTime" FILE_NAME="$file" awk 'BEGIN {
                        rest = ENVIRON["BSD_FORMAT"]; out = ""
                        while ((i = index(rest, "%")) > 0) {
                            out = out substr(rest, 1, i - 1); rest = substr(rest, i)
                            if (substr(rest, 1, 3) == "%Sm") { out = out ENVIRON["MODIFIED_TIME"]; rest = substr(rest, 4) }
                            else if (substr(rest, 1, 2) == "%N") { out = out ENVIRON["FILE_NAME"]; rest = substr(rest, 3) }
                            else { out = out "%"; rest = substr(rest, 2) }
                        }
                        print out rest
                    }'
                else
                    echo "stat: $file: stat: No such file or directory" >&2
                    exitStatus=1
                fi
            done
            exit $exitStatus
            ;;
    esac
fi
exec /usr/bin/stat "$@"
STAT_SCRIPT
# The replay compares exit codes only, so this stand-in keeps the exit code of the wrapped program but not rtk's shortened output.
# Recorded rtk calls: ~/.claude/projects/-Users-matkatmusicllc-Programming-typesafe-playground/2b1644e3-98c4-41f1-9eb3-c8a54e92ae99.jsonl lines 269 and 322.
COPY --chmod=755 <<'RTK_SCRIPT' /usr/local/bin/rtk
#!/bin/sh
if [ "${1:-}" = "read" ]; then
    shift
    exec cat "$@"
fi
exec "$@"
RTK_SCRIPT
# A recorded `ls /Applications | rg -i chrome` found Google Chrome on the Mac; the folder stands in for it (the Chrome program itself is not here).
RUN mkdir -p "/Applications/Google Chrome.app"
RUN useradd --no-create-home --home-dir /tmp/replay-home replay \
    && chmod 755 /var/tmp /run/lock \
    && mkdir -p /private \
    && ln -s /tmp /private/tmp
