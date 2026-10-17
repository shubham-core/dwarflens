// SPDX-License-Identifier: MIT
// DwarfLens — tests/unit/test_wasm_parser.cpp
// Unit and safety tests for WebAssembly binary container parsing.

#include "dwarflens/wasm_parser.hpp"
#include <cassert>
#include <cstdio>
#include <vector>
#include <string>

using namespace dwarflens;

static int tests_run = 0, tests_passed = 0, tests_failed = 0;

#define TEST(name) static void test_##name()
#define RUN(name) do { \
    tests_run++; \
    try { test_##name(); tests_passed++; printf("  ✅ PASS: " #name "\n"); } \
    catch(const std::exception& e) { tests_failed++; printf("  ❌ FAIL: " #name " — %s\n", e.what()); } \
    catch(...) { tests_failed++; printf("  ❌ FAIL: " #name " — unknown exception\n"); } \
} while(0)

#define ASSERT(cond) do { if (!(cond)) throw std::runtime_error("Assertion failed: " #cond " at line " + std::to_string(__LINE__)); } while(0)
#define ASSERT_EQ(a, b) do { if (!((a) == (b))) throw std::runtime_error("ASSERT_EQ failed: " #a " != " #b " at line " + std::to_string(__LINE__)); } while(0)

// Helper to write ULEB128 into a buffer
static void write_uleb128(std::vector<uint8_t>& buf, uint64_t val) {
    do {
        uint8_t byte = val & 0x7F;
        val >>= 7;
        if (val != 0) byte |= 0x80;
        buf.push_back(byte);
    } while (val != 0);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

TEST(wasm_magic_and_version_rejection) {
    // Bad magic
    std::vector<uint8_t> bad_magic = {'x', 'a', 's', 'm', 1, 0, 0, 0};
    auto r1 = WasmParser::parse(bad_magic, "bad_magic.wasm");
    ASSERT(!r1.has_value());

    // Bad version
    std::vector<uint8_t> bad_ver = {0x00, 0x61, 0x73, 0x6D, 2, 0, 0, 0};
    auto r2 = WasmParser::parse(bad_ver, "bad_ver.wasm");
    ASSERT(!r2.has_value());

    // Truncated header
    std::vector<uint8_t> trunc = {0x00, 0x61, 0x73};
    auto r3 = WasmParser::parse(trunc, "trunc.wasm");
    ASSERT(!r3.has_value());
}

TEST(wasm_minimal_valid_module) {
    // \0asm version 1
    std::vector<uint8_t> wasm = {0x00, 0x61, 0x73, 0x6D, 0x01, 0x00, 0x00, 0x00};
    auto r = WasmParser::parse(wasm, "minimal.wasm");
    ASSERT(r.has_value());
    ASSERT_EQ(r->version, 1u);
    ASSERT_EQ(r->file_size, 8u);
    ASSERT(r->sections.empty());
}

TEST(wasm_parse_sections_and_code) {
    std::vector<uint8_t> wasm = {
        0x00, 0x61, 0x73, 0x6D, // magic \0asm
        0x01, 0x00, 0x00, 0x00  // version 1
    };

    // 1. Type Section (id = 1)
    // 1 function type: () -> () (0x60, 0, 0)
    std::vector<uint8_t> type_sec = {
        0x01,       // 1 type
        0x60, 0x00, 0x00 // func type: 0 params, 0 returns
    };
    wasm.push_back(1); // section id
    write_uleb128(wasm, type_sec.size());
    wasm.insert(wasm.end(), type_sec.begin(), type_sec.end());

    // 2. Function Section (id = 3)
    // 1 func with type index 0
    std::vector<uint8_t> func_sec = {
        0x01, // 1 func
        0x00  // type index 0
    };
    wasm.push_back(3); // section id
    write_uleb128(wasm, func_sec.size());
    wasm.insert(wasm.end(), func_sec.begin(), func_sec.end());

    // 3. Export Section (id = 7)
    // Export name "add", kind 0 (func), index 0
    std::vector<uint8_t> export_sec = {
        0x01,                   // 1 export
        0x03, 'a', 'd', 'd',    // string length 3 + "add"
        0x00,                   // kind: func
        0x00                    // func index: 0
    };
    wasm.push_back(7);
    write_uleb128(wasm, export_sec.size());
    wasm.insert(wasm.end(), export_sec.begin(), export_sec.end());

    // 4. Code Section (id = 10)
    // 1 body: size=4, 0 locals, nop (0x01), end (0x0b)
    std::vector<uint8_t> body = {
        0x00,       // 0 local declarations
        0x01,       // nop
        0x0b        // end
    };
    std::vector<uint8_t> code_sec;
    code_sec.push_back(0x01); // 1 body
    write_uleb128(code_sec, body.size());
    code_sec.insert(code_sec.end(), body.begin(), body.end());

    wasm.push_back(10);
    write_uleb128(wasm, code_sec.size());
    wasm.insert(wasm.end(), code_sec.begin(), code_sec.end());

    auto r = WasmParser::parse(wasm, "test.wasm");
    ASSERT(r.has_value());
    ASSERT_EQ(r->sections.size(), 4u);
    ASSERT_EQ(r->exports.size(), 1u);
    ASSERT_EQ(r->exports[0].name, "add");
    ASSERT_EQ(r->functions.size(), 1u);
    ASSERT(r->functions[0].code_size > 0);
    ASSERT(r->code_section_size > 0);
}

int main() {
    printf("\n=== DwarfLens Wasm Parser Unit Tests ===\n\n");
    RUN(wasm_magic_and_version_rejection);
    RUN(wasm_minimal_valid_module);
    RUN(wasm_parse_sections_and_code);

    printf("\n=== Results: %d/%d passed", tests_passed, tests_run);
    if (tests_failed > 0) printf(", %d FAILED ❌", tests_failed);
    printf(" ===\n\n");

    return tests_failed > 0 ? 1 : 0;
}
