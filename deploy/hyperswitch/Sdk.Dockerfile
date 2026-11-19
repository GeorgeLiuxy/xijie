ARG NODE_IMAGE=node:24-alpine@sha256:116b800c3754b440ee0aa3ed2f20f5bf3d99a554bfd9adeea09ea8017f6e85f5
ARG NGINX_IMAGE=nginx:1.28-alpine@sha256:a8b39bd9cf0f83869a2162827a0caf6137ddf759d50a171451b335cecc87d236
FROM ${NODE_IMAGE} AS build
WORKDIR /source
COPY . .
RUN npm ci --ignore-scripts --no-audit --no-fund
ARG API_ORIGIN=http://127.0.0.1:28180
ARG SDK_ORIGIN=http://127.0.0.1:28150
ENV sdkEnv=local SDK_VERSION=v1 ENV_BACKEND_URL=${API_ORIGIN} ENV_SDK_URL=${SDK_ORIGIN} ENABLE_LOGGING=false
RUN node -e "const fs=require('fs'),p='webpack.common.js',s=fs.readFileSync(p,'utf8'),m='const localhostSources = [';if(!s.includes(m))throw Error('SDK CSP source changed');fs.writeFileSync(p,s.replace(m,m+'\\n  process.env.ENV_BACKEND_URL, process.env.ENV_SDK_URL,'))"
RUN node <<'NODE'
const fs = require('fs');
const file = 'public/build.html', source = fs.readFileSync(file, 'utf8');
const pixel = /<img\b[^>]*src="https:\/\/static\.scarf\.sh\/[^"<>]*"[^>]*>/g;
if ((source.match(pixel) || []).length !== 1) throw Error('Pinned SDK telemetry template changed');
fs.writeFileSync(file, source.replace(pixel, ''));
NODE
# Skip upstream start/postinstall hooks: they move submodules to mutable main.
# shared-code is fetched and checked against the SDK's exact gitlink beforehand.
RUN npm run re:build && npm run build
FROM ${NGINX_IMAGE}
LABEL org.opencontainers.image.source="https://github.com/juspay/hyperswitch-web" org.opencontainers.image.revision="f6f83b9c565753dbef70d7f97e03125150e9a1d3" org.opencontainers.image.licenses="Apache-2.0"
COPY --from=build /source/dist /usr/share/nginx/html
COPY --from=build /source/LICENSE /usr/share/nginx/html/LICENSE
EXPOSE 80
