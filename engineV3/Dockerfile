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
        fi; \
        if [ -f "$seedFolder/package-lock.json" ]; then \
            (cd "$seedFolder" && npm ci); \
        fi; \
    done; \
    rm -rf /packageseed; \
    mkdir -p /Users/matkatmusicllc/.bun /npm-cache; \
    chmod -R a+rX /Users/matkatmusicllc/.bun /npm-cache
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
RUN useradd --no-create-home --home-dir /tmp/replay-home replay \
    && chmod 755 /var/tmp /run/lock \
    && mkdir -p /private \
    && ln -s /tmp /private/tmp
