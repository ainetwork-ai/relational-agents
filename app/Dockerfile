# Build context is app/ (see .dockerignore).
FROM node:22-alpine AS base
RUN npm install -g pnpm@11.10.0

FROM base AS deps
WORKDIR /app
# pnpm-workspace.yaml carries ignoredBuiltDependencies — without it pnpm stops
# on ERR_PNPM_IGNORED_BUILDS and the image would diverge from how dev installs.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
# pnpm quarantines packages published in the last 24h. That guard is aimed at
# fresh resolution; here the lockfile is frozen and every entry carries a sha512
# integrity hash, so the versions are already fixed and reviewed. Leaving it on
# would break image builds for a day whenever a dependency publishes.
# strictDepBuilds=false: pnpm-workspace.yaml still has 21 unanswered allowBuilds
# entries, so a strict install stops on ERR_PNPM_IGNORED_BUILDS. Dev has no
# compiled .node artifacts either — everything runs on the pure-JS fallbacks —
# so skipping the build scripts is what makes the image match dev, not diverge.
RUN pnpm install --frozen-lockfile \
      --config.minimumReleaseAge=0 \
      --config.strictDepBuilds=false

FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# NEXT_PUBLIC_* is inlined into the client bundle at build time, so these are
# build args rather than runtime env — changing one requires a rebuild.
ARG NEXT_PUBLIC_RELATION_REGISTRY_ADDRESS
ARG NEXT_PUBLIC_RELATION_REGISTRY_CHAIN_ID
ARG NEXT_PUBLIC_HUMANBACKED_REGISTRY_ADDRESS
ARG NEXT_PUBLIC_WORLD_ID_APP_ID
ARG NEXT_PUBLIC_WORLD_ID_ACTION
ARG NEXT_PUBLIC_SUI_PACKAGE_ID
ARG NEXT_PUBLIC_CALL_WEB_SPEECH
ENV NEXT_STANDALONE=1 NODE_ENV=production NEXT_TELEMETRY_DISABLED=1
# Invoke the binary directly: `pnpm exec` re-runs the dependency status check
# first, which trips over the same unanswered allowBuilds entries.
RUN node_modules/.bin/next build

FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
RUN addgroup -g 1001 -S nodejs && adduser -S nextjs -u 1001
# standalone bundles a traced node_modules; static/ and public/ are not traced.
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
# OKF_ROOT is the content database and is written at runtime — it lives on a
# mounted volume, never in the image.
RUN mkdir -p /data/okf /data/md-mirror && chown -R nextjs:nodejs /data
USER nextjs
EXPOSE 3000
CMD ["node", "server.js"]
