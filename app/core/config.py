from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict
from typing import Optional

_DEV_SECRET_KEY = "dev-secret-change-me"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    # App
    PROJECT_NAME: str = "LogiPlanner"
    API_V1_STR: str = "/api/v1"
    DEBUG: bool = True
    BASE_URL: str = "http://127.0.0.1:8000"

    # Database
    DATABASE_URL: str = "postgresql+psycopg2://postgres:dxdelvin@localhost:5432/logiplanner"

    # Security
    SECRET_KEY: str = _DEV_SECRET_KEY
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 30             # 30 minutes (realistic)
    REFRESH_TOKEN_EXPIRE_DAYS: int = 7                # 7 days

    # Email
    SMTP_HOST: Optional[str] = None
    SMTP_PORT: Optional[int] = None
    SMTP_USER: Optional[str] = None
    SMTP_PASSWORD: Optional[str] = None
    EMAIL_FROM: Optional[str] = None

    # Google OAuth
    GOOGLE_CLIENT_ID: str = ""
    GOOGLE_CLIENT_SECRET: str = ""
    GOOGLE_REDIRECT_URI: str = ""

    # RAG / AI Brain
    OPENAI_API_KEY: str = ""
    RAG_CHUNK_SIZE: int = 800
    RAG_CHUNK_OVERLAP: int = 200
    RAG_CHAT_MODEL: str = "gpt-4o"
    RAG_TOP_K: int = 5
    CHROMA_PERSIST_DIR: str = "./chroma_data"
    HF_EMBEDDING_MODEL: str = "BAAI/bge-base-en-v1.5"

    # GitHub Integration
    GITHUB_TOKEN: Optional[str] = None  # Personal access token for higher API rate limits
    def validate_secret_key(self):
        if not self.DEBUG and self.SECRET_KEY == _DEV_SECRET_KEY:
            raise ValueError("SECRET_KEY must be set explicitly when DEBUG is false")
        return self

    def get_google_redirect_uri(self) -> str:
        """Compute redirect URI at runtime so it always uses the actual BASE_URL."""
        return self.GOOGLE_REDIRECT_URI or f"{self.BASE_URL}/api/v1/google/callback"


settings = Settings()