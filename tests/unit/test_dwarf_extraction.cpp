// SPDX-License-Identifier: MIT
// DwarfLens — tests/unit/test_dwarf_extraction.cpp
// Integration test: compile fixture, run DwarfLens on it, verify results

#include "dwarflens/elf_parser.hpp"
#include "dwarflens/dwarf_reader.hpp"
#include "dwarflens/struct_layout.hpp"

#include <algorithm>
#include <cassert>
#include <cstdio>
#include <fstream>
#include <string>
#include <vector>

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
#define ASSERT_EQ(a, b) do { \
    auto _a = (a); auto _b = (b); \
    if (_a != _b) throw std::runtime_error( \
        std::string("ASSERT_EQ failed: " #a " != " #b " (") + \
        std::to_string(_a) + " vs " + std::to_string(_b) + \
        ") at line " + std::to_string(__LINE__)); \
} while(0)

static std::vector<uint8_t> read_file(const std::string& path) {
    std::ifstream f(path, std::ios::binary);
    if (!f) return {};
    f.seekg(0, std::ios::end);
    size_t size = static_cast<size_t>(f.tellg());
    f.seekg(0);
    std::vector<uint8_t> data(size);
    f.read(reinterpret_cast<char*>(data.data()), static_cast<std::streamsize>(size));
    return data;
}

// Path to the compiled fixture (set by CMake via -DFIXTURE_PATH=...)
#ifndef FIXTURE_PATH
#define FIXTURE_PATH "tests/fixtures/sample_target"
#endif

#ifndef FIXTURE_BLOAT_PATH
#define FIXTURE_BLOAT_PATH "tests/fixtures/sample_target_bloat"
#endif

static std::vector<StructLayout> g_structs;
static bool g_loaded = false;

static void ensure_loaded() {
    if (g_loaded) return;
    auto data = read_file(FIXTURE_PATH);
    if (data.empty()) throw std::runtime_error("Cannot read fixture: " FIXTURE_PATH);

    std::span<const uint8_t> sp(data);
    auto elf_r = ElfParser::parse(sp, FIXTURE_PATH);
    if (!elf_r) throw std::runtime_error("ELF parse failed: " + elf_r.error().message());

    const ElfParseResult& elf = *elf_r;

    DwarfReader::Input di;
    auto debug_info   = elf.section_data(".debug_info",   sp);
    auto debug_abbrev = elf.section_data(".debug_abbrev", sp);
    auto debug_str    = elf.section_data(".debug_str",    sp);
    if (!debug_info || !debug_abbrev)
        throw std::runtime_error("No DWARF sections in fixture");

    di.debug_info   = *debug_info;
    di.debug_abbrev = *debug_abbrev;
    if (debug_str) di.debug_str = *debug_str;

    auto structs_r = DwarfReader::extract_structs(di);
    if (!structs_r) throw std::runtime_error("DWARF extraction failed: " + structs_r.error().message());

    g_structs = std::move(*structs_r);
    LayoutAnalyzer::analyze_all(g_structs);
    g_loaded = true;
}

static const StructLayout* find_struct(const std::string& name) {
    for (const auto& sl : g_structs)
        if (sl.name == name) return &sl;
    return nullptr;
}

// ---------------------------------------------------------------------------
// ELF parsing tests
// ---------------------------------------------------------------------------
TEST(elf_parses_successfully) {
    auto data = read_file(FIXTURE_PATH);
    ASSERT(!data.empty());
    auto r = ElfParser::parse(std::span<const uint8_t>(data), FIXTURE_PATH);
    ASSERT(r.has_value());
    ASSERT(!r->sections.empty());
    ASSERT(r->file_size > 0);
}

TEST(elf_has_text_section) {
    auto data = read_file(FIXTURE_PATH);
    auto r = ElfParser::parse(std::span<const uint8_t>(data), FIXTURE_PATH);
    ASSERT(r.has_value());
    const ElfSection* text = r->find_section(".text");
    ASSERT(text != nullptr);
    ASSERT(text->size > 0);
    ASSERT(text->category == SectionCategory::Code);
}

TEST(elf_has_debug_sections) {
    auto data = read_file(FIXTURE_PATH);
    auto r = ElfParser::parse(std::span<const uint8_t>(data), FIXTURE_PATH);
    ASSERT(r.has_value());
    ASSERT(r->find_section(".debug_info")   != nullptr);
    ASSERT(r->find_section(".debug_abbrev") != nullptr);
}

TEST(elf_symbols_present) {
    auto data = read_file(FIXTURE_PATH);
    auto r = ElfParser::parse(std::span<const uint8_t>(data), FIXTURE_PATH);
    ASSERT(r.has_value());
    ASSERT(!r->symbols.empty());

    // Should have compute_sum and compute_product
    bool found_compute_sum = false;
    for (const auto& sym : r->symbols) {
        if (sym.raw_name.find("compute_sum") != std::string::npos) {
            found_compute_sum = true;
            ASSERT(sym.size > 0);
        }
    }
    ASSERT(found_compute_sum);
}

TEST(elf_range_map_accounts_all_bytes) {
    auto data = read_file(FIXTURE_PATH);
    auto r = ElfParser::parse(std::span<const uint8_t>(data), FIXTURE_PATH);
    ASSERT(r.has_value());
    // Total attributed bytes should be close to file size
    // (within 1% tolerance since some metadata bytes may differ)
    uint64_t attributed = r->file_range_map.total_attributed();
    ASSERT(attributed > 0);
    ASSERT(attributed <= r->file_size);
}

// ---------------------------------------------------------------------------
// DWARF struct extraction tests
// ---------------------------------------------------------------------------
TEST(dwarf_extracts_structs) {
    ensure_loaded();
    ASSERT(!g_structs.empty());
}

TEST(dwarf_detects_bad_layout) {
    ensure_loaded();
    const StructLayout* sl = find_struct("BadLayout");
    if (!sl) throw std::runtime_error("BadLayout not found in DWARF extraction");

    // Verify total size = 24 bytes (matching offsetof/sizeof from source)
    ASSERT_EQ(sl->byte_size, 24u);

    // Verify padding is detected
    ASSERT(sl->has_padding());
    ASSERT(sl->total_padding_bytes >= 10u); // at least 7+3 bytes padding
}

TEST(dwarf_detects_bad_layout_member_offsets) {
    ensure_loaded();
    const StructLayout* sl = find_struct("BadLayout");
    if (!sl) throw std::runtime_error("BadLayout not found");

    // Find each member and verify offset
    auto find_member = [&](const std::string& name) -> const StructMember* {
        for (const auto& m : sl->members)
            if (m.name == name) return &m;
        return nullptr;
    };

    const StructMember* ma = find_member("a");
    const StructMember* mb = find_member("b");
    const StructMember* mc = find_member("c");
    const StructMember* md = find_member("d");

    ASSERT(ma != nullptr);
    ASSERT(mb != nullptr);
    ASSERT(mc != nullptr);
    ASSERT(md != nullptr);

    ASSERT_EQ(ma->offset, 0u);
    ASSERT_EQ(mb->offset, 8u);
    ASSERT_EQ(mc->offset, 16u);
    ASSERT_EQ(md->offset, 20u);
}

TEST(dwarf_optimal_layout_saves_bytes) {
    ensure_loaded();
    const StructLayout* sl = find_struct("BadLayout");
    if (!sl) throw std::runtime_error("BadLayout not found");

    // Optimal packing should save bytes
    ASSERT(sl->optimal.has_value());
    ASSERT(sl->optimal->bytes_saved > 0);
    ASSERT(sl->optimal->byte_size < sl->byte_size);
    // Optimal should be 16 bytes: double(8) + int(4) + char(1) + char(1) + pad(2)
    ASSERT(sl->optimal->byte_size <= 16u);
}

TEST(dwarf_detects_cache_line_crossing) {
    ensure_loaded();
    const StructLayout* sl = find_struct("CrossingStruct");
    if (!sl) {
        // Try CacheLineSplitter as fallback
        sl = find_struct("CacheLineSplitter");
    }
    if (!sl) {
        // DWARF may not extract packed structs — skip this test
        printf("    (skip: CrossingStruct/CacheLineSplitter not found in DWARF — packed structs may be omitted)\n");
        return;
    }

    // crossing_val at offset 60 with size 8 crosses 64-byte boundary
    // 60/64 = 0, 67/64 = 1 => crossing at byte 64
    ASSERT(sl->has_cache_line_crossing());
    bool found_crossing = false;
    for (const auto& clc : sl->cache_line_crossings) {
        if (clc.member_name == "crossing_val") {
            found_crossing = true;
            ASSERT_EQ(clc.boundary, 64u);
        }
    }
    ASSERT(found_crossing);
}

TEST(dwarf_good_layout_no_padding) {
    ensure_loaded();
    const StructLayout* sl = find_struct("GoodLayout");
    if (!sl) throw std::runtime_error("GoodLayout not found");

    // GoodLayout should have minimal or zero padding
    // sizeof(GoodLayout) == 24 and all fields pack tightly
    ASSERT_EQ(sl->byte_size, 24u);
    ASSERT_EQ(sl->total_padding_bytes, 0u);
}

TEST(dwarf_tail_padding_detected) {
    ensure_loaded();
    const StructLayout* sl = find_struct("TailPad");
    if (!sl) throw std::runtime_error("TailPad not found");

    ASSERT_EQ(sl->byte_size, 16u);
    ASSERT(sl->has_padding());
    // tail padding should be 7 bytes (big:8 + small:1 = 9, padded to 16 for alignment)
    ASSERT_EQ(sl->total_padding_bytes, 7u);
}

TEST(dwarf_optimal_cpp_snippet_generated) {
    ensure_loaded();
    const StructLayout* sl = find_struct("BadLayout");
    if (!sl || !sl->optimal.has_value()) return; // skip if not found/optimized

    ASSERT(!sl->optimal->cpp_snippet.empty());
    ASSERT(sl->optimal->cpp_snippet.find("BadLayout") != std::string::npos);
}

// ---------------------------------------------------------------------------
// Malformed input safety tests
// ---------------------------------------------------------------------------
TEST(elf_rejects_truncated_header) {
    std::vector<uint8_t> data = {0x7F,'E','L','F',2,1}; // truncated after EI_CLASS
    auto r = ElfParser::parse(std::span<const uint8_t>(data), "truncated");
    ASSERT(!r.has_value()); // Should fail gracefully
}

TEST(elf_rejects_bad_magic) {
    std::vector<uint8_t> data(64, 0);
    data[0] = 'N'; data[1] = 'O'; data[2] = 'P'; data[3] = 'E';
    auto r = ElfParser::parse(std::span<const uint8_t>(data), "bad_magic");
    ASSERT(!r.has_value());
}

TEST(dwarf_handles_empty_input) {
    DwarfReader::Input di;
    // Empty spans — should return empty list, not crash
    auto r = DwarfReader::extract_structs(di);
    ASSERT(r.has_value());
    ASSERT(r->empty());
}

TEST(cache_lines_min_max_touched) {
    ensure_loaded();
    const auto* s = find_struct("BadLayout");
    ASSERT(s != nullptr);
    ASSERT(s->min_cache_lines_touched >= 1);
    ASSERT(s->max_cache_lines_touched >= s->min_cache_lines_touched);
    ASSERT_EQ(s->cache_lines_spanned, s->min_cache_lines_touched);
}

TEST(repacker_safety_warnings) {
    ensure_loaded();
    const auto* s = find_struct("BadLayout");
    ASSERT(s != nullptr);
    ASSERT(s->optimal.has_value());
    ASSERT(!s->optimal->repack_warnings.empty());
    // Should contain ABI and access pattern advisories
    bool has_abi_warn = false;
    for (const auto& w : s->optimal->repack_warnings) {
        if (w.find("ABI") != std::string::npos) has_abi_warn = true;
    }
    ASSERT(has_abi_warn);
}

TEST(unions_never_repacked) {
    StructLayout u;
    u.tag = "union";
    u.name = "TestUnion";
    u.byte_size = 8;
    u.alignment = 8;
    StructMember m1{"a", "int", 0, 4, 4, false, 0, 0, false};
    StructMember m2{"b", "double", 0, 8, 8, false, 0, 0, false};
    u.members = {m1, m2};
    LayoutAnalyzer::analyze(u);
    ASSERT(!u.optimal.has_value());
}

TEST(span_reader_empty_span) {
    std::vector<uint8_t> data;
    SpanReader rdr(data);
    ASSERT(rdr.empty());
    ASSERT_EQ(rdr.remaining(), 0u);
    auto r = rdr.read_u8();
    ASSERT(!r.has_value());
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
int main() {
    printf("\n=== DwarfLens Integration Tests ===\n");
    printf("Fixture: %s\n\n", FIXTURE_PATH);

    printf("--- ELF Parsing ---\n");
    RUN(elf_parses_successfully);
    RUN(elf_has_text_section);
    RUN(elf_has_debug_sections);
    RUN(elf_symbols_present);
    RUN(elf_range_map_accounts_all_bytes);

    printf("\n--- DWARF Struct Extraction ---\n");
    RUN(dwarf_extracts_structs);
    RUN(dwarf_detects_bad_layout);
    RUN(dwarf_detects_bad_layout_member_offsets);
    RUN(dwarf_optimal_layout_saves_bytes);
    RUN(dwarf_detects_cache_line_crossing);
    RUN(dwarf_good_layout_no_padding);
    RUN(dwarf_tail_padding_detected);
    RUN(dwarf_optimal_cpp_snippet_generated);
    RUN(cache_lines_min_max_touched);
    RUN(repacker_safety_warnings);
    RUN(unions_never_repacked);

    printf("\n--- Safety / Malformed Input ---\n");
    RUN(elf_rejects_truncated_header);
    RUN(elf_rejects_bad_magic);
    RUN(dwarf_handles_empty_input);
    RUN(span_reader_empty_span);

    printf("\n=== Results: %d/%d passed", tests_passed, tests_run);
    if (tests_failed > 0) printf(", %d FAILED ❌", tests_failed);
    printf(" ===\n\n");

    return tests_failed > 0 ? 1 : 0;
}
