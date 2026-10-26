from functools import lru_cache
from pathlib import Path

from cryptography.fernet import Fernet
from pydantic import Field, SecretStr, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Environment-backed settings; secrets belong in the deployment environment."""

    model_config = SettingsConfigDict(
        env_prefix="SYNAPSE_",
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    env: str = "development"
    debug: bool = False
    api_prefix: str = "/api/v1"
    database_url: str = "sqlite:///./synapse.db"
    jwt_secret: str | None = None
    jwt_ttl_minutes: int = 60
    attachments_storage_path: Path = Path("./var/attachments")
    agentscope_redis_host: str = "localhost"
    agentscope_redis_port: int = 6379
    agentscope_redis_password: SecretStr | None = None
    agentscope_storage_redis_db: int = 1
    agentscope_bus_redis_db: int = 2
    agentscope_workspace_path: Path = Path("./var/agentscope/workspaces")
    agentscope_blob_path: Path = Path("./var/agentscope/blobs")
    # None defers to the request scheme; explicit values pin the cookie policy.
    auth_cookie_secure: bool | None = None
    agentscope_qdrant_url: str | None = None
    agentscope_qdrant_path: Path | None = None
    agentscope_knowledge_enabled: bool = False
    agentscope_hubs_enabled: bool = False
    agentscope_scheduler_enabled: bool = False
    agentscope_channel_enabled: bool = False
    agentscope_github_token: SecretStr | None = None
    agentscope_clawhub_token: SecretStr | None = None
    agentscope_download_secret: SecretStr | None = None
    agentscope_credential_encryption_key: SecretStr | None = None
    agentscope_enabled: bool = True
    scheduled_tasks_enabled: bool = True
    scheduled_task_poll_interval_seconds: float = Field(default=5, gt=0, le=3600)
    scheduled_task_lease_seconds: int = Field(default=300, ge=1, le=86400)
    scheduled_task_worker_id: str | None = Field(default=None, min_length=1, max_length=100)

    @field_validator(
        "jwt_secret",
        "agentscope_credential_encryption_key",
        mode="before",
    )
    @classmethod
    def blank_secret_is_unset(cls, value: object) -> object:
        if isinstance(value, str) and not value.strip():
            return None
        return value

    @model_validator(mode="after")
    def validate_deployment_secrets(self) -> "Settings":
        if self.env.lower() not in {"production", "prod"}:
            return self

        if not self.jwt_secret:
            raise ValueError("SYNAPSE_JWT_SECRET is required in production")
        if len(self.jwt_secret.encode("utf-8")) < 32:
            raise ValueError("SYNAPSE_JWT_SECRET must be at least 32 bytes in production")
        if "replace-with" in self.jwt_secret.lower():
            raise ValueError("SYNAPSE_JWT_SECRET must not use an example placeholder")

        if not self.agentscope_credential_encryption_key:
            raise ValueError(
                "SYNAPSE_AGENTSCOPE_CREDENTIAL_ENCRYPTION_KEY is required in production"
            )
        key = self.agentscope_credential_encryption_key.get_secret_value()
        if "replace-with" in key.lower():
            raise ValueError(
                "SYNAPSE_AGENTSCOPE_CREDENTIAL_ENCRYPTION_KEY must not use an example placeholder"
            )
        try:
            Fernet(key.encode("ascii"))
        except (UnicodeEncodeError, ValueError) as exc:
            raise ValueError(
                "SYNAPSE_AGENTSCOPE_CREDENTIAL_ENCRYPTION_KEY must be a valid Fernet key"
            ) from exc
        return self


@lru_cache
def get_settings() -> Settings:
    return Settings()
