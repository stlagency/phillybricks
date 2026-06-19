# Bandbox ingestion worker image (also runs db migrations).
# Used by docker-compose.yml services: `worker` and `migrate`.
#
# STATUS: scaffold. The base + dependency install is real and works; the only
# TODO is whether to prune to a production-only install once the worker has a
# compiled build step (today the worker runs TS via `node --experimental-strip-types`,
# so source + dev typescript are sufficient — see packages/ingestion/package.json).
#
# Build context is the REPO ROOT (compose sets `context: .`) so the whole pnpm
# workspace is available for `pnpm --filter`.

FROM node:20-bookworm-slim

# pnpm via corepack (pinned to the repo's packageManager).
ENV PNPM_HOME=/root/.local/share/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable && corepack prepare pnpm@10.33.0 --activate

WORKDIR /app

# Copy manifests first for layer caching, then install the full workspace.
# (A future optimization: copy only the lockfile + every package.json. For the
#  scaffold we copy everything — correctness over cache granularity.)
COPY . .

# Frozen install across the workspace. `postgres`, `cheerio`, `csv-parse`, `zod`
# are the worker's runtime deps (packages/ingestion/package.json).
RUN pnpm install --frozen-lockfile

# Default command is overridden by compose (run:nightly / migrate). Provide a
# sensible default so `docker run <image>` does something legible.
CMD ["pnpm", "--filter", "@bandbox/ingestion", "run:nightly"]
