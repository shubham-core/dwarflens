// SPDX-License-Identifier: MIT
// DwarfLens — tests/unit/test_macho_pe_parser.cpp
// Unit and safety tests for Mach-O 64-bit and PE/COFF binary container parsers.

#include "dwarflens/macho_parser.hpp"
#include "dwarflens/pe_parser.hpp"
#include <cassert>
#include <cstdio>
#include <cstring>
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

// Helper to push integers to buffer
template <typename T>
void push_le(std::vector<uint8_t>& buf, T val) {
    const uint8_t* p = reinterpret_cast<const uint8_t*>(&val);
    buf.insert(buf.end(), p, p + sizeof(T));
}

// ---------------------------------------------------------------------------
// Mach-O Tests
// ---------------------------------------------------------------------------
TEST(macho_magic_rejection) {
    std::vector<uint8_t> bad = {'N', 'O', 'P', 'E', 1, 2, 3, 4};
    auto r = MachoParser::parse(bad, "bad.dylib");
    ASSERT(!r.has_value());

    std::vector<uint8_t> trunc = {0xcf, 0xfa, 0xed, 0xfe};
    auto r2 = MachoParser::parse(trunc, "trunc.dylib");
    ASSERT(!r2.has_value());
}

TEST(macho_valid_synthetic_binary) {
    std::vector<uint8_t> buf;
    // mach_header_64 (32 bytes)
    push_le<uint32_t>(buf, MachoParser::kMH_MAGIC_64); // magic
    push_le<uint32_t>(buf, 0x01000007); // CPU_TYPE_X86_64
    push_le<uint32_t>(buf, 3);          // cpusubtype
    push_le<uint32_t>(buf, 2);          // MH_EXECUTE
    push_le<uint32_t>(buf, 1);          // ncmds: 1 load command
    push_le<uint32_t>(buf, 72 + 80);    // sizeofcmds (LC_SEGMENT_64 + 1 section_64)
    push_le<uint32_t>(buf, 0);          // flags
    push_le<uint32_t>(buf, 0);          // reserved

    // LC_SEGMENT_64 (72 bytes)
    push_le<uint32_t>(buf, 0x19);       // cmd = LC_SEGMENT_64
    push_le<uint32_t>(buf, 72 + 80);    // cmdsize = 152
    // segname[16] = "__TEXT"
    char seg[16] = "__TEXT";
    buf.insert(buf.end(), seg, seg + 16);
    push_le<uint64_t>(buf, 0x100000000ULL); // vmaddr
    push_le<uint64_t>(buf, 0x1000);         // vmsize
    push_le<uint64_t>(buf, 0);              // fileoff
    push_le<uint64_t>(buf, 256);            // filesize
    push_le<uint32_t>(buf, 7);              // maxprot (rwx)
    push_le<uint32_t>(buf, 5);              // initprot (r-x)
    push_le<uint32_t>(buf, 1);              // nsects = 1
    push_le<uint32_t>(buf, 0);              // flags

    // section_64 (80 bytes)
    char sect[16] = "__text";
    buf.insert(buf.end(), sect, sect + 16);
    buf.insert(buf.end(), seg, seg + 16);
    push_le<uint64_t>(buf, 0x100000050ULL); // addr
    push_le<uint64_t>(buf, 64);             // size = 64 bytes
    push_le<uint32_t>(buf, 160);            // offset = 160
    push_le<uint32_t>(buf, 4);              // align
    push_le<uint32_t>(buf, 0);              // reloff
    push_le<uint32_t>(buf, 0);              // nreloc
    push_le<uint32_t>(buf, 0x80000400);     // flags (some attributes)
    push_le<uint32_t>(buf, 0);              // reserved1
    push_le<uint32_t>(buf, 0);              // reserved2
    push_le<uint32_t>(buf, 0);              // reserved3

    // Pad file to 256 bytes
    buf.resize(256, 0x90); // nop sled

    auto r = MachoParser::parse(buf, "test_macho");
    ASSERT(r.has_value());
    ASSERT_EQ(r->sections.size(), 1u);
    ASSERT_EQ(r->sections[0].full_name, "__TEXT.__text");
    ASSERT_EQ(r->sections[0].category, SectionCategory::Code);
    ASSERT_EQ(r->sections[0].size, 64u);
    ASSERT(r->total_code_size() == 64u);
}

// ---------------------------------------------------------------------------
// PE/COFF Tests
// ---------------------------------------------------------------------------
TEST(pe_magic_rejection) {
    std::vector<uint8_t> bad = {'N', 'O', 'T', 'M', 'Z', 0};
    auto r = PeParser::parse(bad, "bad.exe");
    ASSERT(!r.has_value());

    std::vector<uint8_t> trunc(32, 0);
    trunc[0] = 'M'; trunc[1] = 'Z';
    auto r2 = PeParser::parse(trunc, "trunc.exe");
    ASSERT(!r2.has_value());
}

TEST(pe_valid_synthetic_binary) {
    std::vector<uint8_t> buf(128, 0);
    // DOS header
    buf[0] = 'M'; buf[1] = 'Z';
    // e_lfanew at 0x3C = 64 (0x40)
    buf[0x3C] = 0x40; buf[0x3D] = 0; buf[0x3E] = 0; buf[0x3F] = 0;

    buf.resize(0x40); // align to 64
    // PE signature 'PE\0\0'
    push_le<uint32_t>(buf, PeParser::kPE_MAGIC);

    // COFF file header (20 bytes)
    push_le<uint16_t>(buf, 0x8664); // Machine = AMD64
    push_le<uint16_t>(buf, 1);      // NumberOfSections = 1
    push_le<uint32_t>(buf, 0x1234); // TimeDateStamp
    push_le<uint32_t>(buf, 0);      // PointerToSymbolTable
    push_le<uint32_t>(buf, 0);      // NumberOfSymbols
    push_le<uint16_t>(buf, 24);     // SizeOfOptionalHeader
    push_le<uint16_t>(buf, 0x0022); // Characteristics (EXECUTABLE_IMAGE | LARGE_ADDRESS_AWARE)

    // Optional header (24 bytes min)
    push_le<uint16_t>(buf, 0x20b);  // PE32+ (64-bit)
    buf.resize(buf.size() + 22, 0); // pad rest of optional header

    // Section header (40 bytes)
    char name[8] = ".text";
    buf.insert(buf.end(), name, name + 8);
    push_le<uint32_t>(buf, 0x100);  // VirtualSize = 256
    push_le<uint32_t>(buf, 0x1000); // VirtualAddress = 0x1000
    push_le<uint32_t>(buf, 0x100);  // SizeOfRawData = 256
    push_le<uint32_t>(buf, 0x200);  // PointerToRawData = 0x200
    push_le<uint32_t>(buf, 0);      // PointerToRelocations
    push_le<uint32_t>(buf, 0);      // PointerToLinenumbers
    push_le<uint16_t>(buf, 0);      // NumberOfRelocations
    push_le<uint16_t>(buf, 0);      // NumberOfLinenumbers
    push_le<uint32_t>(buf, 0x60000020); // Characteristics (CODE | EXECUTE | READ)

    // Resize file to encompass raw section data
    buf.resize(0x300, 0xCC); // int 3

    auto r = PeParser::parse(buf, "test.exe");
    ASSERT(r.has_value());
    ASSERT_EQ(r->sections.size(), 1u);
    ASSERT_EQ(r->sections[0].name, ".text");
    ASSERT_EQ(r->sections[0].category, SectionCategory::Code);
    ASSERT_EQ(r->sections[0].raw_size, 256u);
    ASSERT(r->total_code_size() == 256u);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
int main() {
    printf("\n=== DwarfLens Mach-O and PE Parser Unit Tests ===\n\n");
    printf("--- Mach-O 64-bit ---\n");
    RUN(macho_magic_rejection);
    RUN(macho_valid_synthetic_binary);

    printf("\n--- PE/COFF 64-bit ---\n");
    RUN(pe_magic_rejection);
    RUN(pe_valid_synthetic_binary);

    printf("\n=== Results: %d/%d passed", tests_passed, tests_run);
    if (tests_failed > 0) printf(", %d FAILED ❌", tests_failed);
    printf(" ===\n\n");

    return tests_failed > 0 ? 1 : 0;
}
