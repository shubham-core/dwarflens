cmake_minimum_required(VERSION 3.20)
project(dwarflens VERSION 0.1.0 LANGUAGES CXX)

# =============================================================================
# Global settings
# =============================================================================
set(CMAKE_CXX_STANDARD 23)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)
set(CMAKE_EXPORT_COMPILE_COMMANDS ON)

# Default build type
if(NOT CMAKE_BUILD_TYPE)
  set(CMAKE_BUILD_TYPE Release)
endif()

# =============================================================================
# Detect if building for Emscripten (Wasm)
# =============================================================================
if(CMAKE_SYSTEM_NAME STREQUAL "Emscripten")
  set(DWARFLENS_WASM ON)
  message(STATUS "Building for WebAssembly (Emscripten)")
else()
  set(DWARFLENS_WASM OFF)
  message(STATUS "Building for native: ${CMAKE_SYSTEM_NAME} ${CMAKE_SYSTEM_PROCESSOR}")
endif()

# =============================================================================
# Compiler flags
# =============================================================================
set(DWARFLENS_COMPILE_OPTIONS
  -Wall -Wextra -Wpedantic
  -Wno-unused-parameter
)

if(CMAKE_CXX_COMPILER_ID MATCHES "GNU|Clang")
  list(APPEND DWARFLENS_COMPILE_OPTIONS
    -Wformat=2
    -Wnull-dereference
  )
endif()

if(CMAKE_BUILD_TYPE STREQUAL "Debug")
  list(APPEND DWARFLENS_COMPILE_OPTIONS -O0 -g3)
elseif(CMAKE_BUILD_TYPE STREQUAL "RelWithDebInfo")
  list(APPEND DWARFLENS_COMPILE_OPTIONS -O2 -g)
else()
  list(APPEND DWARFLENS_COMPILE_OPTIONS -O2)
endif()

# AddressSanitizer support
option(DWARFLENS_ASAN "Enable AddressSanitizer" OFF)
if(DWARFLENS_ASAN AND NOT DWARFLENS_WASM)
  list(APPEND DWARFLENS_COMPILE_OPTIONS -fsanitize=address,undefined)
  add_link_options(-fsanitize=address,undefined)
endif()

# =============================================================================
# Core library: libdwarflens
# =============================================================================
add_library(libdwarflens STATIC
  core/src/elf_parser.cpp
  core/src/wasm_parser.cpp
  core/src/dwarf_reader.cpp
  core/src/struct_layout.cpp
  core/src/diff_engine.cpp
  core/src/json_serializer.cpp
)

target_include_directories(libdwarflens PUBLIC
  $<BUILD_INTERFACE:${CMAKE_CURRENT_SOURCE_DIR}/core/include>
  $<INSTALL_INTERFACE:include>
)

target_compile_options(libdwarflens PRIVATE ${DWARFLENS_COMPILE_OPTIONS})

# Link flags for native build
if(NOT DWARFLENS_WASM)
  # cxxabi.h is part of libstdc++ — no extra link flags needed on Linux
  # Check if we have libstdc++fs (older GCC)
  if(CMAKE_CXX_COMPILER_ID STREQUAL "GNU" AND CMAKE_CXX_COMPILER_VERSION VERSION_LESS "9.0")
    target_link_libraries(libdwarflens PUBLIC stdc++fs)
  endif()
endif()

# =============================================================================
# Native CLI executable
# =============================================================================
if(NOT DWARFLENS_WASM)
  add_executable(dwarflens cli/main.cpp)
  target_link_libraries(dwarflens PRIVATE libdwarflens)
  target_compile_options(dwarflens PRIVATE ${DWARFLENS_COMPILE_OPTIONS})

  install(TARGETS dwarflens RUNTIME DESTINATION bin)
endif()

# =============================================================================
# WebAssembly bindings (Emscripten only)
# =============================================================================
if(DWARFLENS_WASM)
  add_executable(dwarflens_wasm wasm/bindings.cpp)
  target_link_libraries(dwarflens_wasm PRIVATE libdwarflens)
  target_compile_options(dwarflens_wasm PRIVATE ${DWARFLENS_COMPILE_OPTIONS})

  # Emscripten-specific linker settings
  set_target_properties(dwarflens_wasm PROPERTIES
    SUFFIX ".js"
    LINK_FLAGS
      "-s WASM=1 \
       -s MODULARIZE=1 \
       -s EXPORT_NAME='DwarfLensModule' \
       -s EXPORTED_FUNCTIONS='[\"_malloc\",\"_free\"]' \
       -s EXPORTED_RUNTIME_METHODS='[\"ccall\",\"cwrap\",\"stringToUTF8\",\"UTF8ToString\",\"lengthBytesUTF8\"]' \
       -s ALLOW_MEMORY_GROWTH=1 \
       -s INITIAL_MEMORY=67108864 \
       -s MAXIMUM_MEMORY=2147483648 \
       -s NO_EXIT_RUNTIME=1 \
       -s ASSERTIONS=0 \
       --bind"
  )
endif()

# =============================================================================
# Tests
# =============================================================================
if(NOT DWARFLENS_WASM)
  enable_testing()

  # Compile test fixtures
  set(FIXTURE_DIR ${CMAKE_CURRENT_SOURCE_DIR}/tests/fixtures)
  set(FIXTURE_BIN ${CMAKE_CURRENT_BINARY_DIR}/tests/fixtures/sample_target)
  set(FIXTURE_BLOAT_BIN ${CMAKE_CURRENT_BINARY_DIR}/tests/fixtures/sample_target_bloat)

  file(MAKE_DIRECTORY ${CMAKE_CURRENT_BINARY_DIR}/tests/fixtures)

  add_custom_command(
    OUTPUT ${FIXTURE_BIN}
    COMMAND ${CMAKE_CXX_COMPILER} -std=c++23 -g -O0
            -o ${FIXTURE_BIN}
            ${FIXTURE_DIR}/sample_target.cpp
    DEPENDS ${FIXTURE_DIR}/sample_target.cpp
    COMMENT "Compiling test fixture (base)"
    VERBATIM
  )

  add_custom_command(
    OUTPUT ${FIXTURE_BLOAT_BIN}
    COMMAND ${CMAKE_CXX_COMPILER} -std=c++23 -g -O0 -DBLOAT
            -o ${FIXTURE_BLOAT_BIN}
            ${FIXTURE_DIR}/sample_target.cpp
    DEPENDS ${FIXTURE_DIR}/sample_target.cpp
    COMMENT "Compiling test fixture (bloat)"
    VERBATIM
  )

  add_custom_target(test_fixtures ALL
    DEPENDS ${FIXTURE_BIN} ${FIXTURE_BLOAT_BIN}
  )

  # Unit test: SpanReader and RangeMap
  add_executable(test_span_reader
    tests/unit/test_span_reader.cpp
  )
  target_link_libraries(test_span_reader PRIVATE libdwarflens)
  target_compile_options(test_span_reader PRIVATE ${DWARFLENS_COMPILE_OPTIONS})
  add_test(NAME SpanReaderRangeMap COMMAND test_span_reader)

  # Unit test: WasmParser
  add_executable(test_wasm_parser
    tests/unit/test_wasm_parser.cpp
  )
  target_link_libraries(test_wasm_parser PRIVATE libdwarflens)
  target_compile_options(test_wasm_parser PRIVATE ${DWARFLENS_COMPILE_OPTIONS})
  add_test(NAME WasmParser COMMAND test_wasm_parser)

  # Integration test: DWARF extraction
  add_executable(test_dwarf_extraction
    tests/unit/test_dwarf_extraction.cpp
  )
  target_link_libraries(test_dwarf_extraction PRIVATE libdwarflens)
  target_compile_options(test_dwarf_extraction PRIVATE ${DWARFLENS_COMPILE_OPTIONS})
  target_compile_definitions(test_dwarf_extraction PRIVATE
    FIXTURE_PATH="${FIXTURE_BIN}"
    FIXTURE_BLOAT_PATH="${FIXTURE_BLOAT_BIN}"
  )
  add_dependencies(test_dwarf_extraction test_fixtures)
  add_test(NAME DwarfExtraction COMMAND test_dwarf_extraction)

  # CTest properties
  set_tests_properties(SpanReaderRangeMap WasmParser DwarfExtraction PROPERTIES
    TIMEOUT 60
  )
endif()

# =============================================================================
# Summary
# =============================================================================
message(STATUS "")
message(STATUS "===== DwarfLens Build Configuration =====")
message(STATUS "  Version:     ${PROJECT_VERSION}")
message(STATUS "  Build type:  ${CMAKE_BUILD_TYPE}")
message(STATUS "  C++ std:     C++${CMAKE_CXX_STANDARD} (std::expected needs C++23 on GCC 13)")
message(STATUS "  Compiler:    ${CMAKE_CXX_COMPILER_ID} ${CMAKE_CXX_COMPILER_VERSION}")
message(STATUS "  Wasm build:  ${DWARFLENS_WASM}")
message(STATUS "  ASAN:        ${DWARFLENS_ASAN}")
message(STATUS "==========================================")
message(STATUS "")
