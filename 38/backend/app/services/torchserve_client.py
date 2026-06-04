import asyncio
import logging
from typing import Optional

import httpx
from fastapi import HTTPException, status

from app.config import get_settings
from app.models.schemas import (
    DeviceStatusType,
    TorchServeInferenceRequest,
    TorchServeInferenceResponse,
)

logger = logging.getLogger(__name__)

settings = get_settings()

STATUS_MAP: dict[int, DeviceStatusType] = {
    0: "normal",
    1: "bearing_fault",
    2: "gear_fault",
    3: "imbalance",
}


class TorchServeClient:
    def __init__(self) -> None:
        self.base_url = settings.TORCHSERVE_URL.rstrip("/")
        self.model_name = settings.TORCHSERVE_MODEL_NAME
        self.timeout = settings.TORCHSERVE_TIMEOUT
        self.max_retries = settings.TORCHSERVE_MAX_RETRIES
        self.retry_delay = settings.TORCHSERVE_RETRY_DELAY
        self._client: Optional[httpx.AsyncClient] = None

    async def __aenter__(self) -> "TorchServeClient":
        self._client = httpx.AsyncClient(timeout=self.timeout)
        return self

    async def __aexit__(self, exc_type, exc_val, exc_tb) -> None:
        if self._client is not None:
            await self._client.aclose()
            self._client = None

    async def infer(
        self,
        signal: list[float],
        sample_rate: int,
        window_size: Optional[int] = None,
    ) -> TorchServeInferenceResponse:
        if window_size is None:
            window_size = settings.WINDOW_SIZE

        request = TorchServeInferenceRequest(
            signal=signal,
            sample_rate=sample_rate,
            window_size=window_size,
        )

        return await self._infer_with_retry(request)

    async def _infer_with_retry(
        self, request: TorchServeInferenceRequest
    ) -> TorchServeInferenceResponse:
        last_exception: Optional[Exception] = None

        for attempt in range(1, self.max_retries + 1):
            try:
                return await self._call_torchserve(request)
            except (httpx.HTTPError, httpx.TimeoutException) as e:
                last_exception = e
                logger.warning(
                    f"TorchServe inference attempt {attempt}/{self.max_retries} failed: {e}"
                )
                if attempt < self.max_retries:
                    await asyncio.sleep(self.retry_delay * attempt)

        logger.error(f"TorchServe inference failed after {self.max_retries} retries")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Model inference service is unavailable",
        )

    async def _call_torchserve(
        self, request: TorchServeInferenceRequest
    ) -> TorchServeInferenceResponse:
        if self._client is None:
            self._client = httpx.AsyncClient(timeout=self.timeout)

        url = f"{self.base_url}/predictions/{self.model_name}"
        logger.debug(f"Sending inference request to {url}")

        payload = {
            "signal": request.signal,
            "sample_rate": request.sample_rate,
            "window_size": request.window_size,
        }

        response = await self._client.post(url, json=payload)
        response.raise_for_status()

        result = response.json()
        logger.debug(f"Received inference response: {result}")

        return self._parse_response(result)

    def _parse_response(self, result: dict) -> TorchServeInferenceResponse:
        try:
            if "status" in result and isinstance(result["status"], str):
                status_value: DeviceStatusType = result["status"]
            elif "class" in result:
                class_idx = int(result["class"])
                status_value = STATUS_MAP.get(class_idx, "normal")
            elif "prediction" in result:
                class_idx = int(result["prediction"])
                status_value = STATUS_MAP.get(class_idx, "normal")
            else:
                raise ValueError("Invalid response format: no status or class field")

            confidence = float(result.get("confidence", result.get("probability", 0.0)))

            if "probabilities" in result and isinstance(result["probabilities"], dict):
                probabilities = {
                    k: float(v) for k, v in result["probabilities"].items()
                }
            elif "probs" in result and isinstance(result["probs"], list):
                probs_list = [float(p) for p in result["probs"]]
                probabilities = {
                    status: probs_list[i] if i < len(probs_list) else 0.0
                    for i, status in enumerate(["normal", "bearing_fault", "gear_fault", "imbalance"])
                }
            else:
                probabilities = {s: 0.0 for s in STATUS_MAP.values()}
                probabilities[status_value] = confidence

            return TorchServeInferenceResponse(
                status=status_value,
                confidence=min(1.0, max(0.0, confidence)),
                probabilities=probabilities,
            )
        except (KeyError, ValueError, TypeError) as e:
            logger.error(f"Failed to parse TorchServe response: {e}, result={result}")
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Failed to parse model response",
            )


torchserve_client = TorchServeClient()
