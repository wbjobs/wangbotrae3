import os
import sys

import uvicorn

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from app.config import get_settings

settings = get_settings()


def main() -> None:
    uvicorn.run(
        "app.main:app",
        host=settings.API_HOST,
        port=settings.API_PORT,
        reload=True,
        reload_dirs=["app"],
        log_level=settings.LOG_LEVEL.lower(),
    )


if __name__ == "__main__":
    main()
