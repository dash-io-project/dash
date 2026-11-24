# Cloudflare Containers run linux/amd64. `wrangler deploy` builds and pushes this image.
# Both stages pin the index digest of node:24.22.3-bookworm-slim.

FROM node:24.22.3-bookworm-slim@sha256:4d897dfbf2bed5e4e09128f8b8da96a2bdf36e3cace084a32c9c4e637ec0ff81 AS build

WORKDIR /app
ENV CI=true

COPY package.json ./
RUN corepack enable && corepack install

COPY . .
# ibm_db compiles a native binding during install.
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
RUN pnpm install --frozen-lockfile --filter @dash/web...
RUN pnpm --filter @dash/web build
# The server imports ibm_db from node_modules. Deploy copies the driver and its CLI libraries.
RUN pnpm --filter @dash/adapter-db2 deploy --prod /opt/db2-runtime

FROM node:24.22.3-bookworm-slim@sha256:4d897dfbf2bed5e4e09128f8b8da96a2bdf36e3cace084a32c9c4e637ec0ff81 AS runtime

WORKDIR /app
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    NITRO_HOST=0.0.0.0 \
    NITRO_PORT=3000 \
    DEMO_ENVIRONMENT=false

COPY --from=build --chown=node:node /opt/db2-runtime/node_modules ./node_modules
COPY --from=build --chown=node:node /app/packages/web/.output ./.output

USER node
EXPOSE 3000
CMD ["node", ".output/server/index.mjs"]
