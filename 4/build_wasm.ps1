$ErrorActionPreference = "Stop"

Write-Host "Building Style Transfer WASM Module..." -ForegroundColor Green

if (-not (Get-Command "emcc" -ErrorAction SilentlyContinue)) {
    Write-Host "Error: Emscripten not found. Please install Emscripten first." -ForegroundColor Red
    Write-Host "Visit: https://emscripten.org/docs/getting_started/downloads.html" -ForegroundColor Yellow
    exit 1
}

$wasmDir = "wasm"
if (-not (Test-Path $wasmDir)) {
    New-Item -ItemType Directory -Path $wasmDir | Out-Null
}

$srcFile = "src/cpp/style_transfer.cpp"
$outFile = "wasm/style_transfer.wasm"

$emccArgs = @(
    "-O3",
    "-std=c++17",
    "-s WASM=1",
    "-s EXPORTED_FUNCTIONS=`"['_init_style','_transfer_frame','_process_frame_fast','_malloc','_free']`"",
    "-s EXPORTED_RUNTIME_METHODS=`"['ccall','cwrap']`"",
    "-s ALLOW_MEMORY_GROWTH=1",
    "-s TOTAL_MEMORY=67108864",
    "-s MODULARIZE=1",
    "-o", "wasm/style_transfer.js",
    $srcFile
)

Write-Host "Running emcc..." -ForegroundColor Cyan
& emcc @emccArgs

if ($LASTEXITCODE -eq 0) {
    Write-Host "WASM module built successfully!" -ForegroundColor Green
    Write-Host "Output: $outFile" -ForegroundColor Green
} else {
    Write-Host "Build failed with exit code: $LASTEXITCODE" -ForegroundColor Red
    exit $LASTEXITCODE
}
