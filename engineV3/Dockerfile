FROM node:26-slim
RUN apt-get update \
    && apt-get install -y --no-install-recommends git ripgrep fd-find sd jq curl python3 python-is-python3 python3-pytest procps lsof parallel zsh \
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
    rm -rf /packageseed; \
    mkdir -p /Users/matkatmusicllc/.bun /npm-cache; \
    chmod -R a+rwX /Users/matkatmusicllc/.bun /npm-cache
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
# A recorded `ls /Applications | rg -i chrome` found Google Chrome on the Mac; the folder stands in for it (the Chrome program itself is not here).
RUN mkdir -p "/Applications/Google Chrome.app"
RUN useradd --no-create-home --home-dir /tmp/replay-home replay \
    && chmod 755 /var/tmp /run/lock \
    && mkdir -p /private \
    && ln -s /tmp /private/tmp
