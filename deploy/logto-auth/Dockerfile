FROM ghcr.io/logto-io/logto:1.46.0@sha256:d5e208ce705cbcf7c79ddba421216eb65413d0b0531aa658fb22a4ba659be983
COPY apply-auth-redaction.cjs /tmp/xijie-auth-redaction.cjs
RUN node /tmp/xijie-auth-redaction.cjs && rm /tmp/xijie-auth-redaction.cjs
