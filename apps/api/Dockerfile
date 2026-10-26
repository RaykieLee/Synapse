FROM python:3.13-slim AS builder

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy

COPY --from=ghcr.io/astral-sh/uv:0.11.24 /uv /uvx /bin/

RUN apt-get update \
    && apt-get install --no-install-recommends -y \
        build-essential \
        ca-certificates \
        git \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY apps/api/pyproject.toml apps/api/uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project

COPY apps/api/ ./
RUN uv sync --frozen --no-dev

FROM python:3.13-slim AS runtime

ARG SYNAPSE_JWT_SECRET
ARG SYNAPSE_AGENTSCOPE_CREDENTIAL_ENCRYPTION_KEY

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PATH="/app/.venv/bin:$PATH"

# Clear the names in the runtime layer so the builder layer cannot expose
# secrets inherited through Docker history. Compose injects the real values
# only when the container starts.
ENV SYNAPSE_JWT_SECRET=${SYNAPSE_JWT_SECRET} \
    SYNAPSE_AGENTSCOPE_CREDENTIAL_ENCRYPTION_KEY=${SYNAPSE_AGENTSCOPE_CREDENTIAL_ENCRYPTION_KEY}

RUN groupadd --system synapse \
    && useradd --system --gid synapse --create-home synapse \
    && mkdir -p /app /data \
    && chown -R synapse:synapse /app /data

WORKDIR /app

COPY --from=builder --chown=synapse:synapse /app/.venv /app/.venv
COPY --from=builder --chown=synapse:synapse /app /app
COPY --chown=synapse:synapse apps/api/docker-entrypoint.sh /usr/local/bin/synapse-api-entrypoint

RUN chmod 0755 /usr/local/bin/synapse-api-entrypoint

USER synapse
EXPOSE 8010

ENTRYPOINT ["synapse-api-entrypoint"]
CMD ["uvicorn", "app.main:create_app", "--factory", "--host", "0.0.0.0", "--port", "8010"]

