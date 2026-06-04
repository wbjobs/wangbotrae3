import asyncio
import httpx
import json


async def test_health():
    async with httpx.AsyncClient() as client:
        response = await client.get("http://localhost:8000/health")
        print("=== Health Check ===")
        print(f"Status: {response.status_code}")
        print(json.dumps(response.json(), indent=2, ensure_ascii=False))
        return response.status_code == 200


async def test_detect():
    async with httpx.AsyncClient(timeout=30.0) as client:
        with open("test_audio.wav", "rb") as f:
            files = {"file": ("test_audio.wav", f, "audio/wav")}
            response = await client.post(
                "http://localhost:8000/detect",
                files=files,
            )
        print("\n=== Detect API ===")
        print(f"Status: {response.status_code}")
        print(json.dumps(response.json(), indent=2, ensure_ascii=False))
        return response.status_code == 200


async def test_concurrent():
    print("\n=== Concurrent Test (5 requests) ===")
    async with httpx.AsyncClient(timeout=30.0) as client:
        async def make_request():
            try:
                with open("test_audio.wav", "rb") as f:
                    files = {"file": ("test_audio.wav", f, "audio/wav")}
                    response = await client.post(
                        "http://localhost:8000/detect",
                        files=files,
                    )
                return response.status_code, response.json()
            except Exception as e:
                return None, str(e)

        tasks = [make_request() for _ in range(5)]
        results = await asyncio.gather(*tasks)

        success_count = 0
        too_many_count = 0
        for i, (status, data) in enumerate(results):
            if status == 200:
                success_count += 1
                print(f"Request {i+1}: 200 OK")
            elif status == 429:
                too_many_count += 1
                print(f"Request {i+1}: 429 Too Many Requests")
            else:
                print(f"Request {i+1}: {status} - {data}")

        print(f"\nSuccess: {success_count}, 429: {too_many_count}")
        return too_many_count > 0 or success_count > 0


async def main():
    try:
        ok1 = await test_health()
        ok2 = await test_detect()
        ok3 = await test_concurrent()
        print(f"\n=== Summary ===")
        print(f"Health check: {'PASS' if ok1 else 'FAIL'}")
        print(f"Detect API: {'PASS' if ok2 else 'FAIL'}")
        print(f"Concurrent test: {'PASS' if ok3 else 'FAIL'}")
    except Exception as e:
        print(f"Error: {e}")
        import traceback
        traceback.print_exc()


if __name__ == "__main__":
    asyncio.run(main())
