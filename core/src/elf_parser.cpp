// SPDX-License-Identifier: MIT
// DwarfLens — elf_parser.cpp
// ELF64 binary parser implementation.

#if defined(__cplusplus) && __cplusplus <= 202002L
#  undef __cplusplus
#  define __cplusplus 202302L
#endif

#include "dwarflens/elf_parser.hpp"
#include <cxxabi.h>
#include <algorithm>
#include <cstdlib>
#include <cstring>
#include <regex>
#include <string>
#include <string_view>
#include <system_error>
#include <unordered_set>
#include <vector>

namespace dwarflens {

namespace {

enum class ElfError : int {
    InvalidMagic = 1,
    UnsupportedClass,
    UnsupportedEndianness,
    InvalidHeader,
    InvalidSectionHeaders,
    InvalidStringTable,
    OutOfBounds,
};

struct ElfErrorCategory : std::error_category {
    [[nodiscard]] const char* name() const noexcept override { return "dwarflens.elf"; }
    [[nodiscard]] std::string message(int ev) const override {
        switch (static_cast<ElfError>(ev)) {
            case ElfError::InvalidMagic:          return "invalid ELF magic";
            case ElfError::UnsupportedClass:      return "unsupported ELF class (not ELFCLASS64)";
            case ElfError::UnsupportedEndianness: return "unsupported ELF data encoding (not little-endian)";
            case ElfError::InvalidHeader:         return "invalid ELF header";
            case ElfError::InvalidSectionHeaders: return "invalid ELF section headers";
            case ElfError::InvalidStringTable:    return "invalid ELF string table";
            case ElfError::OutOfBounds:           return "out of bounds reading ELF";
        }
        return "unknown ELF error";
    }
};

const ElfErrorCategory& elf_error_category() noexcept {
    static ElfErrorCategory cat;
    return cat;
}

std::error_code make_error_code(ElfError e) noexcept {
    return {static_cast<int>(e), elf_error_category()};
}

} // anonymous namespace

// ---------------------------------------------------------------------------
// Section classification
// ---------------------------------------------------------------------------
SectionCategory ElfParser::classify_section(const ElfSection& s) {
    if (s.name.starts_with(".debug_") || s.name.starts_with(".zdebug_")) {
        return SectionCategory::DebugInfo;
    }
    if (s.type == kSHT_NOBITS) {
        return SectionCategory::BSS;
    }
    if (s.flags & kSHF_EXECINSTR) {
        return SectionCategory::Code;
    }
    if (s.type == kSHT_SYMTAB || s.type == kSHT_DYNSYM || s.type == kSHT_STRTAB ||
        s.type == kSHT_RELA || s.type == kSHT_REL ||
        s.name == ".symtab" || s.name == ".strtab" || s.name == ".shstrtab" ||
        s.name == ".dynsym" || s.name == ".dynstr" || s.name == ".dynamic" ||
        s.name.starts_with(".note") || s.name == ".hash" || s.name == ".gnu.hash" ||
        s.name.starts_with(".gnu.version")) {
        return SectionCategory::Metadata;
    }
    if ((s.flags & kSHF_ALLOC) && (s.flags & kSHF_WRITE)) {
        return SectionCategory::RWData;
    }
    if ((s.flags & kSHF_ALLOC) && !(s.flags & kSHF_WRITE) && !(s.flags & kSHF_EXECINSTR)) {
        return SectionCategory::ROData;
    }
    if (s.type == kSHT_NULL) {
        return SectionCategory::Other;
    }
    if (!(s.flags & kSHF_ALLOC)) {
        return SectionCategory::Metadata;
    }
    return SectionCategory::Other;
}

// ---------------------------------------------------------------------------
// Demangling
// ---------------------------------------------------------------------------
std::string ElfParser::demangle(const std::string& mangled) {
    if (mangled.empty()) {
        return {};
    }
    int status = 0;
    char* demangled = abi::__cxa_demangle(mangled.c_str(), nullptr, nullptr, &status);
    if (status == 0 && demangled != nullptr) {
        std::string result(demangled);
        std::free(demangled);
        return result;
    }
    if (demangled != nullptr) {
        std::free(demangled);
    }
    return mangled;
}

// ---------------------------------------------------------------------------
// Template grouping
// ---------------------------------------------------------------------------
std::string ElfParser::template_group(const std::string& demangled) {
    size_t first_open = demangled.find('<');
    if (first_open == std::string::npos) {
        return demangled;
    }

    int depth = 0;
    size_t match_close = std::string::npos;
    for (size_t i = first_open; i < demangled.size(); ++i) {
        if (demangled[i] == '<') {
            ++depth;
        } else if (demangled[i] == '>') {
            --depth;
            if (depth == 0) {
                match_close = i;
                break;
            }
        }
    }

    if (match_close != std::string::npos) {
        std::string prefix = demangled.substr(0, first_open);
        std::string suffix = template_group(demangled.substr(match_close + 1));
        return prefix + "<...>" + suffix;
    }

    return demangled;
}

// ---------------------------------------------------------------------------
// ELF64 Parsing
// ---------------------------------------------------------------------------
std::expected<ElfParseResult, ElfParser::Error>
ElfParser::parse(std::span<const uint8_t> data, std::string filename) {
    if (data.size() < sizeof(Elf64Ehdr)) {
        return std::unexpected(make_error_code(ElfError::InvalidHeader));
    }

    SpanReader reader(data);

    Elf64Ehdr ehdr{};
    for (size_t i = 0; i < 16; ++i) {
        auto b = reader.read_u8();
        if (!b) return std::unexpected(b.error());
        ehdr.e_ident[i] = *b;
    }

    // 1. Validate magic bytes (0x7F, 'E', 'L', 'F')
    if (ehdr.e_ident[0] != kElfMagic[0] ||
        ehdr.e_ident[1] != kElfMagic[1] ||
        ehdr.e_ident[2] != kElfMagic[2] ||
        ehdr.e_ident[3] != kElfMagic[3]) {
        return std::unexpected(make_error_code(ElfError::InvalidMagic));
    }

    // Validate class (ELFCLASS64 = 2)
    if (ehdr.e_ident[4] != kELFCLASS64) {
        return std::unexpected(make_error_code(ElfError::UnsupportedClass));
    }

    // Validate data encoding (little-endian = 1)
    if (ehdr.e_ident[5] != kELFDATA2LSB) {
        return std::unexpected(make_error_code(ElfError::UnsupportedEndianness));
    }

    auto e_type = reader.read_u16_le();
    if (!e_type) return std::unexpected(e_type.error());
    ehdr.e_type = *e_type;

    auto e_machine = reader.read_u16_le();
    if (!e_machine) return std::unexpected(e_machine.error());
    ehdr.e_machine = *e_machine;

    auto e_version = reader.read_u32_le();
    if (!e_version) return std::unexpected(e_version.error());
    ehdr.e_version = *e_version;

    auto e_entry = reader.read_u64_le();
    if (!e_entry) return std::unexpected(e_entry.error());
    ehdr.e_entry = *e_entry;

    auto e_phoff = reader.read_u64_le();
    if (!e_phoff) return std::unexpected(e_phoff.error());
    ehdr.e_phoff = *e_phoff;

    auto e_shoff = reader.read_u64_le();
    if (!e_shoff) return std::unexpected(e_shoff.error());
    ehdr.e_shoff = *e_shoff;

    auto e_flags = reader.read_u32_le();
    if (!e_flags) return std::unexpected(e_flags.error());
    ehdr.e_flags = *e_flags;

    auto e_ehsize = reader.read_u16_le();
    if (!e_ehsize) return std::unexpected(e_ehsize.error());
    ehdr.e_ehsize = *e_ehsize;

    auto e_phentsize = reader.read_u16_le();
    if (!e_phentsize) return std::unexpected(e_phentsize.error());
    ehdr.e_phentsize = *e_phentsize;

    auto e_phnum = reader.read_u16_le();
    if (!e_phnum) return std::unexpected(e_phnum.error());
    ehdr.e_phnum = *e_phnum;

    auto e_shentsize = reader.read_u16_le();
    if (!e_shentsize) return std::unexpected(e_shentsize.error());
    ehdr.e_shentsize = *e_shentsize;

    auto e_shnum = reader.read_u16_le();
    if (!e_shnum) return std::unexpected(e_shnum.error());
    ehdr.e_shnum = *e_shnum;

    auto e_shstrndx = reader.read_u16_le();
    if (!e_shstrndx) return std::unexpected(e_shstrndx.error());
    ehdr.e_shstrndx = *e_shstrndx;

    ElfParseResult result;
    result.filename = std::move(filename);
    result.file_size = data.size();
    result.type = ehdr.e_type;
    result.machine = ehdr.e_machine;
    result.entry_point = ehdr.e_entry;

    // If there are no section headers, fill gaps and return
    if (ehdr.e_shoff == 0) {
        result.file_range_map.fill_gaps(0, result.file_size);
        return result;
    }

    if (ehdr.e_shentsize < sizeof(Elf64Shdr)) {
        return std::unexpected(make_error_code(ElfError::InvalidSectionHeaders));
    }

    auto read_shdr_at = [&](size_t offset) -> std::expected<Elf64Shdr, std::error_code> {
        auto seek_res = reader.seek(offset);
        if (!seek_res) return std::unexpected(seek_res.error());
        Elf64Shdr sh{};
        auto n = reader.read_u32_le(); if (!n) return std::unexpected(n.error()); sh.sh_name = *n;
        auto t = reader.read_u32_le(); if (!t) return std::unexpected(t.error()); sh.sh_type = *t;
        auto f = reader.read_u64_le(); if (!f) return std::unexpected(f.error()); sh.sh_flags = *f;
        auto a = reader.read_u64_le(); if (!a) return std::unexpected(a.error()); sh.sh_addr = *a;
        auto o = reader.read_u64_le(); if (!o) return std::unexpected(o.error()); sh.sh_offset = *o;
        auto s = reader.read_u64_le(); if (!s) return std::unexpected(s.error()); sh.sh_size = *s;
        auto l = reader.read_u32_le(); if (!l) return std::unexpected(l.error()); sh.sh_link = *l;
        auto inf = reader.read_u32_le(); if (!inf) return std::unexpected(inf.error()); sh.sh_info = *inf;
        auto align = reader.read_u64_le(); if (!align) return std::unexpected(align.error()); sh.sh_addralign = *align;
        auto entsz = reader.read_u64_le(); if (!entsz) return std::unexpected(entsz.error()); sh.sh_entsize = *entsz;
        return sh;
    };

    // Read section header 0 to handle potential extended section numbering
    if (ehdr.e_shoff + sizeof(Elf64Shdr) > data.size() || ehdr.e_shoff + sizeof(Elf64Shdr) < ehdr.e_shoff) {
        return std::unexpected(make_error_code(ElfError::OutOfBounds));
    }
    auto sh0_res = read_shdr_at(ehdr.e_shoff);
    if (!sh0_res) return std::unexpected(sh0_res.error());
    Elf64Shdr sh0 = *sh0_res;

    uint32_t shnum = ehdr.e_shnum;
    if (shnum == 0 && sh0.sh_size > 0) {
        shnum = static_cast<uint32_t>(sh0.sh_size);
    }

    uint32_t shstrndx = ehdr.e_shstrndx;
    if (shstrndx == 0xffff && sh0.sh_link != 0) {
        shstrndx = sh0.sh_link;
    }

    // Bounds check section header table
    if (shnum > 0) {
        uint64_t total_shdr_size = static_cast<uint64_t>(shnum) * ehdr.e_shentsize;
        if (ehdr.e_shoff + total_shdr_size > data.size() || ehdr.e_shoff + total_shdr_size < ehdr.e_shoff) {
            return std::unexpected(make_error_code(ElfError::OutOfBounds));
        }
    }

    std::vector<Elf64Shdr> raw_shdrs;
    raw_shdrs.reserve(shnum);
    for (uint32_t i = 0; i < shnum; ++i) {
        uint64_t offset = ehdr.e_shoff + static_cast<uint64_t>(i) * ehdr.e_shentsize;
        auto sh_res = read_shdr_at(offset);
        if (!sh_res) return std::unexpected(sh_res.error());
        raw_shdrs.push_back(*sh_res);
    }

    // Set up .shstrtab reader
    std::optional<SpanReader> shstr_reader;
    if (shstrndx < raw_shdrs.size()) {
        const auto& shstr_hdr = raw_shdrs[shstrndx];
        if (shstr_hdr.sh_offset + shstr_hdr.sh_size > data.size() ||
            shstr_hdr.sh_offset + shstr_hdr.sh_size < shstr_hdr.sh_offset) {
            return std::unexpected(make_error_code(ElfError::InvalidStringTable));
        }
        auto sub = reader.sub_reader(shstr_hdr.sh_offset, shstr_hdr.sh_size);
        if (!sub) return std::unexpected(sub.error());
        shstr_reader = *sub;
    }

    // Populate ElfSection list
    result.sections.reserve(raw_shdrs.size());
    for (uint32_t i = 0; i < raw_shdrs.size(); ++i) {
        const auto& raw = raw_shdrs[i];

        // Bounds check section in file (if not SHT_NOBITS)
        if (raw.sh_type != kSHT_NOBITS && raw.sh_size > 0) {
            if (raw.sh_offset + raw.sh_size > data.size() || raw.sh_offset + raw.sh_size < raw.sh_offset) {
                return std::unexpected(make_error_code(ElfError::OutOfBounds));
            }
        }

        ElfSection sec;
        sec.index = i;
        sec.type = raw.sh_type;
        sec.flags = raw.sh_flags;
        sec.addr = raw.sh_addr;
        sec.offset = raw.sh_offset;
        sec.size = raw.sh_size;
        sec.link = raw.sh_link;
        sec.info = raw.sh_info;
        sec.addralign = raw.sh_addralign;
        sec.entsize = raw.sh_entsize;

        if (raw.sh_name != 0 && shstr_reader.has_value()) {
            auto name_res = shstr_reader->read_cstring_at(raw.sh_name);
            if (name_res) {
                sec.name = std::string(*name_res);
            }
        }

        sec.category = classify_section(sec);
        result.sections.push_back(std::move(sec));
    }

    // Helper to find string table for a symbol table section
    auto find_strtab_for = [&](const ElfSection& sym_sec, std::string_view fallback_name) -> const ElfSection* {
        if (sym_sec.link < result.sections.size() && result.sections[sym_sec.link].type == kSHT_STRTAB) {
            return &result.sections[sym_sec.link];
        }
        return result.find_section(fallback_name);
    };

    std::unordered_set<std::string> seen_symbols;

    auto parse_symbols_from = [&](const ElfSection& sym_sec, const ElfSection& str_sec) -> std::expected<void, std::error_code> {
        if (sym_sec.size == 0) return {};
        uint64_t entsize = sym_sec.entsize ? sym_sec.entsize : sizeof(Elf64Sym);
        if (entsize < sizeof(Elf64Sym)) return {};

        auto sym_sub = reader.sub_reader(sym_sec.offset, sym_sec.size);
        if (!sym_sub) return std::unexpected(sym_sub.error());
        SpanReader sym_rdr = *sym_sub;

        auto str_sub = reader.sub_reader(str_sec.offset, str_sec.size);
        if (!str_sub) return std::unexpected(str_sub.error());
        SpanReader str_rdr = *str_sub;

        size_t num_symbols = sym_sec.size / entsize;
        for (size_t j = 0; j < num_symbols; ++j) {
            size_t entry_start = j * entsize;
            auto seek_res = sym_rdr.seek(entry_start);
            if (!seek_res) return std::unexpected(seek_res.error());

            auto st_name_r = sym_rdr.read_u32_le();
            if (!st_name_r) return std::unexpected(st_name_r.error());
            uint32_t st_name = *st_name_r;

            auto st_info_r = sym_rdr.read_u8();
            if (!st_info_r) return std::unexpected(st_info_r.error());
            uint8_t st_info = *st_info_r;

            auto st_other_r = sym_rdr.read_u8();
            if (!st_other_r) return std::unexpected(st_other_r.error());
            (void)*st_other_r;

            auto st_shndx_r = sym_rdr.read_u16_le();
            if (!st_shndx_r) return std::unexpected(st_shndx_r.error());
            uint16_t st_shndx = *st_shndx_r;

            auto st_value_r = sym_rdr.read_u64_le();
            if (!st_value_r) return std::unexpected(st_value_r.error());
            uint64_t st_value = *st_value_r;

            auto st_size_r = sym_rdr.read_u64_le();
            if (!st_size_r) return std::unexpected(st_size_r.error());
            uint64_t st_size = *st_size_r;

            uint8_t type = st_info & 0x0f;
            uint8_t bind = st_info >> 4;

            // Skip STT_FILE and STT_SECTION types
            if (type == kSTT_FILE || type == kSTT_SECTION) {
                continue;
            }

            if (st_name == 0) {
                continue;
            }

            auto name_res = str_rdr.read_cstring_at(st_name);
            if (!name_res || name_res->empty()) {
                continue;
            }

            std::string raw_name(*name_res);

            // Deduplication key: raw_name + value + size + section
            std::string key = raw_name + "@" + std::to_string(st_value) + ":" +
                              std::to_string(st_size) + ":" + std::to_string(st_shndx);
            if (!seen_symbols.insert(key).second) {
                continue;
            }

            std::string demangled = demangle(raw_name);
            std::string templ = template_group(demangled);

            std::string sec_name;
            if (st_shndx < result.sections.size()) {
                sec_name = result.sections[st_shndx].name;
            }

            ElfSymbol sym;
            sym.raw_name = std::move(raw_name);
            sym.demangled_name = std::move(demangled);
            sym.template_group = std::move(templ);
            sym.value = st_value;
            sym.size = st_size;
            sym.type = type;
            sym.bind = bind;
            sym.section_index = st_shndx;
            sym.section_name = std::move(sec_name);
            sym.compile_unit = "";

            result.symbols.push_back(std::move(sym));
        }
        return {};
    };

    // 3. Parse .symtab (and .dynsym)
    for (const auto& sec : result.sections) {
        if (sec.type == kSHT_SYMTAB) {
            const ElfSection* strtab = find_strtab_for(sec, ".strtab");
            if (strtab) {
                auto r = parse_symbols_from(sec, *strtab);
                if (!r) return std::unexpected(r.error());
            }
        }
    }

    for (const auto& sec : result.sections) {
        if (sec.type == kSHT_DYNSYM) {
            const ElfSection* dynstr = find_strtab_for(sec, ".dynstr");
            if (dynstr) {
                auto r = parse_symbols_from(sec, *dynstr);
                if (!r) return std::unexpected(r.error());
            }
        }
    }

    // 5. Build file_range_map and vm_range_map
    // Insert sections at AttributionLevel::Section
    for (const auto& s : result.sections) {
        if (s.index == 0 || s.size == 0) continue;

        if (s.type != kSHT_NOBITS && s.offset + s.size <= result.file_size) {
            result.file_range_map.insert(
                s.offset,
                s.offset + s.size,
                s.name,
                AttributionLevel::Section,
                s.name
            );
        }

        if (s.flags & kSHF_ALLOC) {
            result.vm_range_map.insert(
                s.addr,
                s.addr + s.size,
                s.name,
                AttributionLevel::Section,
                s.name
            );
        }
    }

    // Insert symbols at AttributionLevel::Symbol
    for (const auto& sym : result.symbols) {
        if (sym.size == 0) continue;
        if (sym.section_index == 0 || sym.section_index >= result.sections.size()) continue;

        const auto& s = result.sections[sym.section_index];
        const std::string& label = sym.demangled_name.empty() ? sym.raw_name : sym.demangled_name;

        // file_range_map
        if (s.type != kSHT_NOBITS) {
            uint64_t file_start = 0;
            bool valid = false;
            if (result.type == kET_REL) {
                file_start = s.offset + sym.value;
                valid = (sym.value < s.size);
            } else if (sym.value >= s.addr && (sym.value - s.addr) < s.size) {
                file_start = s.offset + (sym.value - s.addr);
                valid = true;
            }

            if (valid) {
                uint64_t file_end = std::min(file_start + sym.size, s.offset + s.size);
                if (file_end > file_start && file_end <= result.file_size) {
                    result.file_range_map.insert(
                        file_start,
                        file_end,
                        label,
                        AttributionLevel::Symbol,
                        s.name,
                        sym.compile_unit
                    );
                }
            }
        }

        // vm_range_map
        if (s.flags & kSHF_ALLOC) {
            uint64_t vm_start = (result.type == kET_REL) ? (s.addr + sym.value) : sym.value;
            bool valid_vm = false;
            if (result.type == kET_REL) {
                valid_vm = (sym.value < s.size);
            } else {
                valid_vm = (sym.value >= s.addr && (sym.value - s.addr) < s.size);
            }

            if (valid_vm) {
                uint64_t vm_end = std::min(vm_start + sym.size, s.addr + s.size);
                if (vm_end > vm_start) {
                    result.vm_range_map.insert(
                        vm_start,
                        vm_end,
                        label,
                        AttributionLevel::Symbol,
                        s.name,
                        sym.compile_unit
                    );
                }
            }
        }
    }

    // Fill gaps in file_range_map to attribute unclaimed bytes
    result.file_range_map.fill_gaps(0, result.file_size);

    return result;
}

} // namespace dwarflens
