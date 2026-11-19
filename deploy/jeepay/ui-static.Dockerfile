ARG NGINX_IMAGE=nginx:1.28-alpine
FROM ${NGINX_IMAGE}
ENV NGINX_ENVSUBST_FILTER=^BACKEND_HOST$
COPY public/ /workspace/
COPY LICENSE /usr/share/doc/jeepay-ui/LICENSE
COPY default.conf.template /etc/nginx/templates/default.conf.template
RUN rm -f /etc/nginx/conf.d/default.conf
