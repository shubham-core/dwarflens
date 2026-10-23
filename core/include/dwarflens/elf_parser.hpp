// SPDX-License-Identifier: MIT
// DwarfLens — elf_parser.hpp
// ELF64 binary parser: sections, symbols, DWARF section discovery.
#pragma once
#include "span_reader.hpp"
#include "range_map.hpp"
#include <cstdint>
#include "expected.hpp"
#include <optional>
#include <string>
#include <string_view>
#include <vector>
#include <functional>

namespace dwarflens {

// ---------------------------------------------------------------------------
// ELF constants (subset of elf.h — portable, no system header dependency)
// ---------------------------------------------------------------------------
static constexpr uint8_t kElfMagic[4] = {0x7F, 'E', 'L', 'F'};
static constexpr uint8_t kELFCLASS64 = 2;
static constexpr uint8_t kELFDATA2LSB = 1; // little-endian
static constexpr uint16_t kET_EXEC  = 2;
static constexpr uint16_t kET_DYN   = 3;
static constexpr uint16_t kET_REL   = 1;

static constexpr uint32_t kSHT_NULL     = 0;
static constexpr uint32_t kSHT_PROGBITS = 1;
static constexpr uint32_t kSHT_SYMTAB   = 2;
static constexpr uint32_t kSHT_STRTAB   = 3;
static constexpr uint32_t kSHT_RELA     = 4;
static constexpr uint32_t kSHT_NOBITS   = 8;
static constexpr uint32_t kSHT_REL      = 9;
static constexpr uint32_t kSHT_DYNSYM   = 11;

static constexpr uint32_t kSHF_ALLOC   = 0x2;
static constexpr uint32_t kSHF_EXECINSTR = 0x4;
static constexpr uint32_t kSHF_WRITE   = 0x1;

static constexpr uint8_t kSTT_NOTYPE  = 0;
static constexpr uint8_t kSTT_OBJECT  = 1;
static constexpr uint8_t kSTT_FUNC    = 2;
static constexpr uint8_t kSTT_SECTION = 3;
static constexpr uint8_t kSTT_FILE    = 4;

// ---------------------------------------------------------------------------
// Parsed ELF structures
// ---------------------------------------------------------------------------
enum class SectionCategory : uint8_t {
    Code,       // .text, SHF_EXECINSTR
    ROData,     // .rodata, SHF_ALLOC | !WRITE | !EXEC
    RWData,     // .data, SHF_ALLOC | WRITE | !EXEC
    BSS,        // SHT_NOBITS
    DebugInfo,  // .debug_*
    Metadata,   // .symtab, .strtab, .dynamic, etc.
    Other,
};

struct ElfSection {
    uint32_t index{};
    std::string name;
    uint32_t type{};
    uint64_t flags{};
    uint64_t addr{};
    uint64_t offset{};
    uint64_t size{};
    uint32_t link{};
    uint32_t info{};
    uint64_t addralign{};
    uint64_t entsize{};
    SectionCategory category{SectionCategory::Other};

    [[nodiscard]] bool is_compressed() const noexcept {
        return (flags & 0x800) != 0 || name.rfind(".zdebug", 0) == 0;
    }
};

struct ElfSymbol {
    std::string raw_name;
    std::string demangled_name;
    std::string template_group; // e.g. "Foo<...>" for all Foo<T> instantiations
    uint64_t value{};           // symbol value (VM address)
    uint64_t size{};
    uint8_t  type{};            // STT_*
    uint8_t  bind{};
    uint16_t section_index{};
    std::string section_name;
    std::string compile_unit;
};

struct ElfParseResult {
    std::string filename;
    uint64_t file_size{};
    uint16_t type{};            // ET_EXEC, ET_DYN, ET_REL
    uint16_t machine{};
    uint64_t entry_point{};

    std::vector<ElfSection> sections;
    std::vector<ElfSymbol>  symbols;
    RangeMap file_range_map;
    RangeMap vm_range_map;

    // Section lookup by name
    [[nodiscard]] const ElfSection* find_section(std::string_view name) const {
        for (const auto& s : sections)
            if (s.name == name) return &s;
        return nullptr;
    }

    // DWARF section accessor helpers
    [[nodiscard]] std::optional<std::span<const uint8_t>>
    section_data(std::string_view name,
                 std::span<const uint8_t> file_bytes) const {
        const ElfSection* s = find_section(name);
        if (!s || s->offset + s->size > file_bytes.size()) return std::nullopt;
        if (s->size == 0) return std::nullopt;
        return file_bytes.subspan(static_cast<size_t>(s->offset),
                                  static_cast<size_t>(s->size));
    }

    // Size summaries
    [[nodiscard]] uint64_t total_code_size() const {
        uint64_t sum = 0;
        for (const auto& s : sections)
            if (s.category == SectionCategory::Code) sum += s.size;
        return sum;
    }
    [[nodiscard]] uint64_t total_rodata_size() const {
        uint64_t sum = 0;
        for (const auto& s : sections)
            if (s.category == SectionCategory::ROData) sum += s.size;
        return sum;
    }
    [[nodiscard]] uint64_t total_data_size() const {
        uint64_t sum = 0;
        for (const auto& s : sections)
            if (s.category == SectionCategory::RWData) sum += s.size;
        return sum;
    }
    [[nodiscard]] uint64_t total_bss_size() const {
        uint64_t sum = 0;
        for (const auto& s : sections)
            if (s.category == SectionCategory::BSS) sum += s.size;
        return sum;
    }
    [[nodiscard]] uint64_t flash_size() const {
        return total_code_size() + total_rodata_size() + total_data_size();
    }
    [[nodiscard]] uint64_t ram_size() const {
        return total_data_size() + total_bss_size();
    }
};

// ---------------------------------------------------------------------------
// ElfParser
// ---------------------------------------------------------------------------
class ElfParser {
public:
    using Error = std::error_code;

    [[nodiscard]] static std::expected<ElfParseResult, Error>
    parse(std::span<const uint8_t> data, std::string filename = {});

private:
    struct Elf64Ehdr {
        uint8_t  e_ident[16];
        uint16_t e_type;
        uint16_t e_machine;
        uint32_t e_version;
        uint64_t e_entry;
        uint64_t e_phoff;
        uint64_t e_shoff;
        uint32_t e_flags;
        uint16_t e_ehsize;
        uint16_t e_phentsize;
        uint16_t e_phnum;
        uint16_t e_shentsize;
        uint16_t e_shnum;
        uint16_t e_shstrndx;
    };
    static_assert(sizeof(Elf64Ehdr) == 64);

    struct Elf64Shdr {
        uint32_t sh_name;
        uint32_t sh_type;
        uint64_t sh_flags;
        uint64_t sh_addr;
        uint64_t sh_offset;
        uint64_t sh_size;
        uint32_t sh_link;
        uint32_t sh_info;
        uint64_t sh_addralign;
        uint64_t sh_entsize;
    };
    static_assert(sizeof(Elf64Shdr) == 64);

    struct Elf64Sym {
        uint32_t st_name;
        uint8_t  st_info;
        uint8_t  st_other;
        uint16_t st_shndx;
        uint64_t st_value;
        uint64_t st_size;
    };
    static_assert(sizeof(Elf64Sym) == 24);

    [[nodiscard]] static SectionCategory classify_section(const ElfSection& s);
    [[nodiscard]] static std::string demangle(const std::string& mangled);
    [[nodiscard]] static std::string template_group(const std::string& demangled);
};

} // namespace dwarflens
