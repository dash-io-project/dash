FROM mongo:8.2.12@sha256:e0ce8c35124d4a9f9785532d1f268f39e9728ffa1cb38f46fa482436424c4bd3

USER root
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl \
  && rm -rf /var/lib/apt/lists/*

COPY entrypoint.sh /opt/dash/entrypoint.sh
COPY healthcheck.sh /opt/dash/healthcheck.sh
COPY init /opt/dash/init
RUN chmod 755 /opt/dash/entrypoint.sh /opt/dash/healthcheck.sh

ENTRYPOINT ["bash", "/opt/dash/entrypoint.sh"]
