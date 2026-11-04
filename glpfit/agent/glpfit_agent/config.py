from pathlib import Path

from openai import OpenAI
from pydantic import Field, SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict

PROJECT_ROOT = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    # env.txt is a fallback for machines where .env cannot be edited; later files win.
    model_config = SettingsConfigDict(
        env_file=(PROJECT_ROOT / ".env", PROJECT_ROOT / "env.txt"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    model_api_key: SecretStr = SecretStr("")
    # Meta's dashboard calls it META_API_KEY; accept either name.
    meta_api_key: SecretStr = SecretStr("")
    meta_base_url: str = "https://api.meta.ai/v1"
    meta_model: str = "muse-spark-1.3"
    meta_timeout_seconds: float = Field(default=90, gt=0, le=600)
    meta_max_output_tokens: int = Field(default=4096, ge=128, le=32768)
    meta_max_agent_steps: int = Field(default=6, ge=1, le=20)

    @property
    def api_key(self) -> str:
        for key in (self.model_api_key, self.meta_api_key):
            value = key.get_secret_value().strip()
            if value:
                return value
        return ""

    @property
    def has_key(self) -> bool:
        return bool(self.api_key)


def create_client(settings: Settings) -> OpenAI:
    if not settings.has_key:
        raise ValueError(".env 또는 env.txt에 MODEL_API_KEY(또는 META_API_KEY)를 입력하세요.")
    return OpenAI(
        api_key=settings.api_key,
        base_url=settings.meta_base_url,
        timeout=settings.meta_timeout_seconds,
        max_retries=1,
    )
