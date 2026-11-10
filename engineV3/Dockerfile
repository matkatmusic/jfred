FROM node:26-slim
RUN apt-get update \
    && apt-get install -y --no-install-recommends git ripgrep fd-find sd jq curl python3 procps lsof \
    && rm -rf /var/lib/apt/lists/* \
    && git config --system safe.directory '*' \
    && ln -s /usr/bin/fdfind /usr/local/bin/fd
COPY --from=oven/bun:1.4.3 /usr/local/bin/bun /usr/local/bin/bun
RUN ln -s /usr/local/bin/bun /usr/local/bin/bunx
RUN npm install -g tsx@4.23.1
RUN useradd --no-create-home --home-dir /tmp/replay-home replay \
    && chmod 755 /var/tmp /run/lock \
    && mkdir -p /private \
    && ln -s /tmp /private/tmp
