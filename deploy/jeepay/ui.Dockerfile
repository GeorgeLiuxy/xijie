ARG NODE_IMAGE=node:22-alpine
ARG NGINX_IMAGE=nginx:1.28-alpine
FROM ${NODE_IMAGE} AS builder
ARG PLATFORM
ENV NODE_OPTIONS=--max-old-space-size=1536
ENV VITE_API_BASE_URL=""
ENV VITE_APP_BASE_URL=/
ENV VITE_BASE_URL=/cashier/
WORKDIR /workspace
COPY . .
COPY --from=deployment registry-lock.mjs /tmp/registry-lock.mjs
RUN case "$PLATFORM" in cashier|manager|merchant) ;; *) exit 2;; esac \
 && cd "jeepay-ui-$PLATFORM" \
 && node /tmp/registry-lock.mjs package-lock.json \
 && npm ci --ignore-scripts --no-audit --no-fund --registry=https://registry.npmjs.org \
 && npm run build \
 && mv dist /out
FROM ${NGINX_IMAGE}
ENV NGINX_ENVSUBST_FILTER=^BACKEND_HOST$
COPY --from=builder /out/ /workspace/
COPY LICENSE /usr/share/doc/jeepay-ui/LICENSE
COPY --from=deployment default.conf.template /etc/nginx/templates/default.conf.template
RUN rm -f /etc/nginx/conf.d/default.conf

