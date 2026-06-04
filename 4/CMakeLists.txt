cmake_minimum_required(VERSION 3.15)
project(StyleTransferWASM)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

if(EMSCRIPTEN)
    set(WASM_OUTPUT_DIR "${CMAKE_BINARY_DIR}/wasm")
    file(MAKE_DIRECTORY ${WASM_OUTPUT_DIR})
    
    add_executable(style_transfer src/cpp/style_transfer.cpp)
    
    set_target_properties(style_transfer PROPERTIES
        OUTPUT_NAME "style_transfer"
        SUFFIX ".js"
        RUNTIME_OUTPUT_DIRECTORY ${WASM_OUTPUT_DIR}
    )
    
    target_compile_options(style_transfer PRIVATE
        -O3
        -s WASM=1
    )
    
    target_link_options(style_transfer PRIVATE
        -O3
        -s WASM=1
        -s EXPORTED_FUNCTIONS=["_init_style","_transfer_frame","_process_frame_fast","_malloc","_free"]
        -s EXPORTED_RUNTIME_METHODS=["ccall","cwrap"]
        -s ALLOW_MEMORY_GROWTH=1
        -s TOTAL_MEMORY=67108864
        -s MODULARIZE=1
        -s EXPORT_ES6=1
    )
endif()
