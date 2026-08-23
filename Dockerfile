# Build stage: compile the community node package (web bundle + tsc)
FROM node:22-alpine AS build
WORKDIR /build

# --ignore-scripts skips isolated-vm's native build (not needed for compiling)
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts

COPY web/package.json web/package-lock.json* ./web/
RUN npm --prefix web install

COPY . .
RUN npm run build

# Final stage: official n8n image loading the node via N8N_CUSTOM_EXTENSIONS.
# We do NOT run `npm install` inside n8n's dir because its package.json now uses
# pnpm catalogs (npm chokes with EUNSUPPORTEDPROTOCOL "catalog:").
FROM n8nio/n8n:latest
USER root

# CustomDirectoryLoader globs **/*.node.js in this dir; nesting under
# node_modules/ makes require('n8n-workflow') resolve via the parent dir.
COPY --from=build /build/dist /opt/custom/node_modules/n8n-nodes-jsonform/dist
COPY --from=build /build/package.json /opt/custom/node_modules/n8n-nodes-jsonform/package.json

# Reuse n8n's own n8n-workflow instead of bundling a duplicate copy.
RUN ln -s "$(readlink -f /usr/local/lib/node_modules/n8n/node_modules/n8n-workflow)" \
        /opt/custom/node_modules/n8n-workflow

ENV N8N_CUSTOM_EXTENSIONS=/opt/custom
USER node
