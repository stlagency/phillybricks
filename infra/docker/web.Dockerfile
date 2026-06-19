# Bandbox Next.js web image.
# Used by docker-compose.yml service: `web`.
#
# STATUS: scaffold. The dependency install is real. The production build step
# below assumes `pnpm --filter @bandbox/web build` produces a standalone
# server. TODO before this is prod-ready:
#   - set `output: 'standalone'` in apps/web/next.config.mjs (owned by the web
#     package) so the runtime image can be slimmed to the standalone bundle;
#   - split into builder + runner stages once standalone output exists.
# Until then this single stage builds and runs from the full workspace, which is
# correct but larger than a tuned multi-stage image.
#
# Build context is the REPO ROOT (compose sets `context: .`).

FROM node:20-bookworm-slim

ENV PNPM_HOME=/root/.local/share/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable && corepack prepare pnpm@10.33.0 --activate

WORKDIR /app

COPY . .

RUN pnpm install --frozen-lockfile

# Build the Next app. transpilePackages handles @bandbox/core source.
RUN pnpm --filter @bandbox/web build

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

CMD ["pnpm", "--filter", "@bandbox/web", "start"]
