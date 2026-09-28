# ---------------------------------------------------------------------------
# ADRA client support app: Docker image for Render (or any Docker host).
# Stage 1 builds the app with Node; stage 2 serves the built files with nginx.
# ---------------------------------------------------------------------------

# ---- 1. Build ----
FROM node:22-alpine AS build
WORKDIR /app

# Install dependencies first so Docker can reuse this layer between builds
COPY package.json package-lock.json ./
RUN npm ci

COPY . .
# Set to "off" at build time to hide the yellow TEST VERSION banner
ARG VITE_TEST_BANNER=on
ENV VITE_TEST_BANNER=$VITE_TEST_BANNER
RUN npm run build

# ---- 2. Serve ----
FROM nginx:1.27-alpine

# Render tells the container which port to listen on through $PORT (default 10000).
# nginx's official image fills ${PORT} into files in /etc/nginx/templates at start-up.
ENV PORT=10000
COPY nginx.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 10000
# (nginx's default command starts the server)
