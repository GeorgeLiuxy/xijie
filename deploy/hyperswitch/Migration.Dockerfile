FROM debian:trixie-slim@sha256:a72b4433de1cf7d6bae0c4cee74d0547f58601a643b3375f070c51600d63b6b2
RUN apt-get update && apt-get install -y --no-install-recommends libpq5 libsqlite3-0 libmariadb3 ca-certificates && rm -rf /var/lib/apt/lists/*
COPY diesel /usr/local/bin/diesel
RUN chmod 755 /usr/local/bin/diesel && diesel --version
ENTRYPOINT ["diesel","migration","run","--migration-dir","/migrations"]
