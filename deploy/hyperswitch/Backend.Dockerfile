ARG RUST_IMAGE=rust:1.94.1-trixie@sha256:652612f07bfbbdfa3af34761c1e435094c00dde4a98036132fca28c7bb2b165c
ARG RUNTIME_IMAGE=debian:trixie-slim@sha256:a72b4433de1cf7d6bae0c4cee74d0547f58601a643b3375f070c51600d63b6b2
FROM ${RUST_IMAGE} AS build
RUN apt-get update && apt-get install -y --no-install-recommends libpq-dev libssl-dev pkg-config protobuf-compiler libprotobuf-dev clang lld ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /source
COPY . .
ENV CARGO_BUILD_JOBS=2 CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 CARGO_PROFILE_DEV_INCREMENTAL=false CARGO_NET_RETRY=3
RUN --mount=type=cache,id=xijie-hs-8e75-cargo-registry,target=/usr/local/cargo/registry --mount=type=cache,id=xijie-hs-8e75-cargo-git,target=/usr/local/cargo/git --mount=type=cache,id=xijie-hs-8e75-target,target=/source/target cargo build --locked --bin router --no-default-features --features v1,oltp,olap,redis-rs,accounts_cache,stripe && mkdir -p /out && cp target/debug/router /out/router
FROM ${RUNTIME_IMAGE} AS runtime
LABEL org.opencontainers.image.source="https://github.com/juspay/hyperswitch" org.opencontainers.image.revision="8e75ce7cce0b462b37d76601ac264a7f603674cc" org.opencontainers.image.licenses="Apache-2.0"
RUN apt-get update && apt-get install -y --no-install-recommends libpq5 libssl3t64 ca-certificates curl && rm -rf /var/lib/apt/lists/* && useradd --system --no-create-home router
WORKDIR /local
COPY --from=build /out/router /local/bin/router
COPY --from=build /source/config /local/config
COPY --from=build /source/LICENSE /local/LICENSE
RUN mkdir -p /local/files && chown router:router /local/files
ENV RUN_ENV=development RUST_MIN_STACK=6291456
USER router
ENTRYPOINT ["/local/bin/router","-f","/local/config/local.toml"]
