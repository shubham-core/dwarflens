// SPDX-License-Identifier: MIT
// DwarfLens — tests/unit/test_span_reader.cpp
// Unit tests for SpanReader and RangeMap
// Uses a lightweight test framework (no external deps)

#include "dwarflens/span_reader.hpp"
#include "dwarflens/range_map.hpp"
#include <cassert>
#include <cstdio>
#include <vector>
#include <string>

using namespace dwarflens;

// Simple test harness
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

// ---------------------------------------------------------------------------
// SpanReader tests
// ---------------------------------------------------------------------------
TEST(read_u8_basic) {
    std::vector<uint8_t> data = {0x42, 0xFF, 0x00};
    SpanReader rdr(data);
    ASSERT_EQ(rdr.cursor(), 0u);
    ASSERT_EQ(rdr.remaining(), 3u);

    auto r = rdr.read_u8();
    ASSERT(r.has_value());
    ASSERT_EQ(*r, 0x42u);
    ASSERT_EQ(rdr.cursor(), 1u);

    r = rdr.read_u8();
    ASSERT_EQ(*r, 0xFFu);
    r = rdr.read_u8();
    ASSERT_EQ(*r, 0x00u);
    ASSERT(rdr.empty());
}

TEST(read_u8_oob) {
    std::vector<uint8_t> data = {0x01};
    SpanReader rdr(data);
    auto r1 = rdr.read_u8(); ASSERT(r1.has_value());
    auto r2 = rdr.read_u8(); // should fail
    ASSERT(!r2.has_value());
    ASSERT_EQ(r2.error(), make_error_code(ReadError::OutOfBounds));
}

TEST(read_u16_le) {
    std::vector<uint8_t> data = {0x34, 0x12}; // LE 0x1234
    SpanReader rdr(data);
    auto r = rdr.read_u16_le();
    ASSERT(r.has_value());
    ASSERT_EQ(*r, 0x1234u);
}

TEST(read_u32_le) {
    std::vector<uint8_t> data = {0x78, 0x56, 0x34, 0x12}; // LE 0x12345678
    SpanReader rdr(data);
    auto r = rdr.read_u32_le();
    ASSERT(r.has_value());
    ASSERT_EQ(*r, 0x12345678u);
}

TEST(read_u64_le) {
    std::vector<uint8_t> data = {
        0x08,0x07,0x06,0x05,0x04,0x03,0x02,0x01
    }; // LE 0x0102030405060708
    SpanReader rdr(data);
    auto r = rdr.read_u64_le();
    ASSERT(r.has_value());
    ASSERT_EQ(*r, 0x0102030405060708ULL);
}

TEST(read_u32_oob) {
    std::vector<uint8_t> data = {0x01, 0x02}; // only 2 bytes
    SpanReader rdr(data);
    auto r = rdr.read_u32_le();
    ASSERT(!r.has_value());
    ASSERT_EQ(r.error(), make_error_code(ReadError::OutOfBounds));
}

TEST(uleb128_single_byte) {
    // 0x01 = 1 (no continuation bit)
    std::vector<uint8_t> data = {0x01};
    SpanReader rdr(data);
    auto r = rdr.read_uleb128();
    ASSERT(r.has_value());
    ASSERT_EQ(*r, 1u);
}

TEST(uleb128_two_bytes) {
    // ULEB128 for 300: 0xAC 0x02
    // 300 = 0b100101100 -> 7-bit groups: 0101100 | 0000010
    // bytes: (0101100 | 0x80) = 0xAC, then 0x02
    std::vector<uint8_t> data = {0xAC, 0x02};
    SpanReader rdr(data);
    auto r = rdr.read_uleb128();
    ASSERT(r.has_value());
    ASSERT_EQ(*r, 300u);
}

TEST(uleb128_large_value) {
    // ULEB128 for 624485: 0xE5 0x8E 0x26
    std::vector<uint8_t> data = {0xE5, 0x8E, 0x26};
    SpanReader rdr(data);
    auto r = rdr.read_uleb128();
    ASSERT(r.has_value());
    ASSERT_EQ(*r, 624485u);
}

TEST(uleb128_oob) {
    // Incomplete encoding — continuation bit set but no more bytes
    std::vector<uint8_t> data = {0x80};
    SpanReader rdr(data);
    auto r = rdr.read_uleb128();
    ASSERT(!r.has_value());
}

TEST(sleb128_positive) {
    // SLEB128 for 128: 0x80 0x01
    std::vector<uint8_t> data = {0x80, 0x01};
    SpanReader rdr(data);
    auto r = rdr.read_sleb128();
    ASSERT(r.has_value());
    ASSERT_EQ(*r, 128LL);
}

TEST(sleb128_negative) {
    // SLEB128 for -1: 0x7F
    std::vector<uint8_t> data = {0x7F};
    SpanReader rdr(data);
    auto r = rdr.read_sleb128();
    ASSERT(r.has_value());
    ASSERT_EQ(*r, -1LL);
}

TEST(sleb128_negative_large) {
    // SLEB128 for -123456
    // -123456 in SLEB128: encode step by step
    // Using known encoding: 0xC0 0xBB 0x78
    std::vector<uint8_t> data = {0xC0, 0xBB, 0x78};
    SpanReader rdr(data);
    auto r = rdr.read_sleb128();
    ASSERT(r.has_value());
    ASSERT_EQ(*r, -123456LL);
}

TEST(read_cstring_basic) {
    std::vector<uint8_t> data = {'h','e','l','l','o',0,'w','o','r','l','d',0};
    SpanReader rdr(data);
    auto r = rdr.read_cstring();
    ASSERT(r.has_value());
    ASSERT(*r == "hello");
    r = rdr.read_cstring();
    ASSERT(r.has_value());
    ASSERT(*r == "world");
    ASSERT(rdr.empty());
}

TEST(read_cstring_unterminated) {
    std::vector<uint8_t> data = {'h','e','l','l','o'};
    SpanReader rdr(data);
    auto r = rdr.read_cstring();
    ASSERT(!r.has_value());
    ASSERT_EQ(r.error(), make_error_code(ReadError::InvalidString));
}

TEST(cstring_at_offset) {
    std::vector<uint8_t> data = {0,'h','e','l','l','o',0,'b','y','e',0};
    SpanReader rdr(data);
    auto r = rdr.read_cstring_at(1);
    ASSERT(r.has_value());
    ASSERT(*r == "hello");
    r = rdr.read_cstring_at(7);
    ASSERT(r.has_value());
    ASSERT(*r == "bye");
}

TEST(seek_and_skip) {
    std::vector<uint8_t> data = {0,1,2,3,4,5,6,7};
    SpanReader rdr(data);
    auto sk = rdr.skip(3);
    ASSERT(sk.has_value());
    ASSERT_EQ(rdr.cursor(), 3u);
    auto se = rdr.seek(6);
    ASSERT(se.has_value());
    ASSERT_EQ(rdr.cursor(), 6u);
    auto se2 = rdr.seek(100); // oob
    ASSERT(!se2.has_value());
}

TEST(sub_reader) {
    std::vector<uint8_t> data = {0,1,2,3,4,5,6,7};
    SpanReader rdr(data);
    auto sub = rdr.sub_reader(2, 4);
    ASSERT(sub.has_value());
    ASSERT_EQ(sub->size(), 4u);
    auto r = sub->read_u8();
    ASSERT(r.has_value());
    ASSERT_EQ(*r, 2u);
}

// ---------------------------------------------------------------------------
// RangeMap tests
// ---------------------------------------------------------------------------
TEST(rangemap_insert_basic) {
    RangeMap rm;
    rm.insert(0, 100, ".text", AttributionLevel::Section);
    rm.insert(100, 200, ".data", AttributionLevel::Section);

    ASSERT_EQ(rm.entries().size(), 2u);
    ASSERT_EQ(rm.total_attributed(), 200u);
}

TEST(rangemap_split_on_finer_insert) {
    RangeMap rm;
    rm.insert(0, 100, ".text", AttributionLevel::Section);
    // Insert a symbol that splits .text
    rm.insert(10, 40, "my_func", AttributionLevel::Symbol);

    const auto& entries = rm.entries();
    // Should have: [0,10)=.text, [10,40)=my_func, [40,100)=.text
    ASSERT_EQ(entries.size(), 3u);

    // Check byte conservation
    uint64_t total = 0;
    for (const auto& e : entries) total += e.size();
    ASSERT_EQ(total, 100u);
}

TEST(rangemap_fill_gaps) {
    RangeMap rm;
    rm.insert(10, 50, ".text", AttributionLevel::Section);
    rm.fill_gaps(0, 100, "[Gap]");

    const auto& entries = rm.entries();
    // Should have: [0,10)=[Gap], [10,50)=.text, [50,100)=[Gap]
    uint64_t total = 0;
    for (const auto& e : entries) total += e.size();
    ASSERT_EQ(total, 100u); // all bytes accounted for
}

TEST(rangemap_lookup) {
    RangeMap rm;
    rm.insert(0, 50, "A", AttributionLevel::Section);
    rm.insert(50, 100, "B", AttributionLevel::Section);

    auto r1 = rm.lookup(25);
    ASSERT(r1.has_value());
    ASSERT((*r1)->label == "A");

    auto r2 = rm.lookup(75);
    ASSERT(r2.has_value());
    ASSERT((*r2)->label == "B");

    auto r3 = rm.lookup(100); // out of range
    ASSERT(!r3.has_value());
}

TEST(rangemap_no_double_counting) {
    RangeMap rm;
    rm.insert(0, 1000, ".text", AttributionLevel::Section);

    // Insert many symbols
    rm.insert(0,   100, "func_a", AttributionLevel::Symbol);
    rm.insert(100, 300, "func_b", AttributionLevel::Symbol);
    rm.insert(300, 700, "func_c", AttributionLevel::Symbol);
    rm.insert(700, 900, "func_d", AttributionLevel::Symbol);
    // 900-1000 left as .text

    uint64_t total = 0;
    for (const auto& e : rm.entries()) total += e.size();
    ASSERT_EQ(total, 1000u); // exactly 1000 bytes, no double-counting
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
int main() {
    printf("\n=== DwarfLens Unit Tests ===\n\n");

    printf("--- SpanReader ---\n");
    RUN(read_u8_basic);
    RUN(read_u8_oob);
    RUN(read_u16_le);
    RUN(read_u32_le);
    RUN(read_u64_le);
    RUN(read_u32_oob);
    RUN(uleb128_single_byte);
    RUN(uleb128_two_bytes);
    RUN(uleb128_large_value);
    RUN(uleb128_oob);
    RUN(sleb128_positive);
    RUN(sleb128_negative);
    RUN(sleb128_negative_large);
    RUN(read_cstring_basic);
    RUN(read_cstring_unterminated);
    RUN(cstring_at_offset);
    RUN(seek_and_skip);
    RUN(sub_reader);

    printf("\n--- RangeMap ---\n");
    RUN(rangemap_insert_basic);
    RUN(rangemap_split_on_finer_insert);
    RUN(rangemap_fill_gaps);
    RUN(rangemap_lookup);
    RUN(rangemap_no_double_counting);

    printf("\n=== Results: %d/%d passed", tests_passed, tests_run);
    if (tests_failed > 0) printf(", %d FAILED ❌", tests_failed);
    printf(" ===\n\n");

    return tests_failed > 0 ? 1 : 0;
}
