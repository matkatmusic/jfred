FROM python:3.14-slim
RUN apt-get update \
    && apt-get install -y --no-install-recommends git \
    && rm -rf /var/lib/apt/lists/* \
    && git config --system safe.directory '*' \
    && git config --system user.name reveng-box \
    && git config --system user.email box@reveng.invalid
