from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    APP_NAME: str = "Chaos Test Platform"
    APP_VERSION: str = "1.0.0"
    
    INFLUXDB_URL: str = "http://influxdb:8086"
    INFLUXDB_TOKEN: str = "chaos-test-token"
    INFLUXDB_ORG: str = "chaos-org"
    INFLUXDB_BUCKET: str = "iot-data"
    
    POSTGRES_HOST: str = "postgres"
    POSTGRES_PORT: int = 5432
    POSTGRES_USER: str = "postgres"
    POSTGRES_PASSWORD: str = "chaos-test-pass"
    POSTGRES_DB: str = "chaos_test"
    
    BACKEND_HOST: str = "0.0.0.0"
    BACKEND_PORT: int = 8000
    
    DEFAULT_SIMULATION_INTERVAL: float = 1.0
    MAX_DEVICES: int = 100
    
    class Config:
        env_file = ".env"


settings = Settings()
