from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    supabase_url: str
    supabase_anon_key: str
    cors_origins: str = "http://localhost:5173,http://127.0.0.1:5173,http://[::1]:5173"

    model_config = SettingsConfigDict(env_file=".env")


settings = Settings()