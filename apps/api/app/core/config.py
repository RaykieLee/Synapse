from functools import lru_cache
from pathlib import Path

from pydantic import Field, SecretStr
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
    agentscope_download_secret: SecretStr | None = None
    agentscope_credential_encryption_key: SecretStr | None = None
    scheduled_tasks_enabled: bool = True
    scheduled_task_poll_interval_seconds: float = Field(default=5, gt=0, le=3600)
    scheduled_task_lease_seconds: int = Field(default=300, ge=1, le=86400)
    scheduled_task_worker_id: str | None = Field(default=None, min_length=1, max_length=100)


@lru_cache
def get_settings() -> Settings:
    return Settings()
