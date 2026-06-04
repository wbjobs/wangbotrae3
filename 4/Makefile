EMCC = emcc
CXXFLAGS = -O3 -std=c++17 -s WASM=1 -s EXPORTED_FUNCTIONS='["_init_style", "_transfer_frame", "_process_frame_fast", "_malloc", "_free"]' -s EXPORTED_RUNTIME_METHODS='["ccall", "cwrap"]' -s ALLOW_MEMORY_GROWTH=1 -s TOTAL_MEMORY=67108864

SRC = src/cpp/style_transfer.cpp
OUT = wasm/style_transfer.wasm

.PHONY: all clean

all: $(OUT)

$(OUT): $(SRC)
	@mkdir -p wasm
	$(EMCC) $(CXXFLAGS) $(SRC) -o $(OUT:.wasm=.js)
	@echo "WASM compiled successfully"

clean:
	rm -rf wasm
