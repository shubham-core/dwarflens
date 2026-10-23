// SPDX-License-Identifier: MIT
// DwarfLens — macho_parser.cpp
// 64-bit Mach-O parser implementation.
#include "dwarflens/macho_parser.hpp"
#include <algorithm>
#if __has_include(<cxxabi.h>)
#  include <cxxabi.h>
#endif
#include <cstdlib>
#include <cstring>
#include <system_error>

namespace dwarflens {

namespace {

enum class MachoError : int {
    BadMagic = 1,
    TruncatedHeader,
    TruncatedCommands,
    InvalidSegment,
    InvalidSymtab,
};

struct MachoErrorCategory : std::error_category {
    const char* name() const noexcept override { return "dwarflens.macho"; }
    std::string message(int ev) const override {
        switch (static_cast<MachoError>(ev)) {
            case MachoError::BadMagic: return "not a valid 64-bit Mach-O binary";
            case MachoError::TruncatedHeader: return "truncated Mach-O header";
            case MachoError::TruncatedCommands: return "truncated load commands";
            case MachoError::InvalidSegment: return "invalid segment command";
            case MachoError::InvalidSymtab: return "invalid symtab command";
        }
        return "unknown Mach-O error";
    }
};

const MachoErrorCategory& macho_error_category() noexcept {
    static MachoErrorCategory cat;
    return cat;
}

std::error_code make_macho_error(MachoError e) noexcept {
    return {static_cast<int>(e), macho_error_category()};
}

// Fixed Mach-O load command IDs
static constexpr uint32_t kLC_SEGMENT_64 = 0x19;
static constexpr uint32_t kLC_SYMTAB     = 0x02;

std::string read_fixed_string(std::span<const uint8_t> sp, size_t max_len) {
    size_t len = 0;
    while (len < max_len && len < sp.size() && sp[len] != 0) {
        ++len;
    }
    return std::string(reinterpret_cast<const char*>(sp.data()), len);
}

} // anonymous namespace

SectionCategory MachoParser::classify_section(std::string_view seg, std::string_view sect) {
    if (sect.starts_with("__debug_") || seg == "__DWARF") return SectionCategory::DebugInfo;
    if (sect == "__text" || sect.starts_with("__text_")) return SectionCategory::Code;
    if (sect == "__const" || sect == "__cstring" || sect == "__literal4" ||
        sect == "__literal8" || sect == "__literal16" || sect == "__rodata")
        return SectionCategory::ROData;
    if (sect == "__bss" || sect == "__zerofill") return SectionCategory::BSS;
    if (sect == "__data" || sect.starts_with("__data_") || sect == "__common") return SectionCategory::RWData;
    if (seg == "__LINKEDIT" || sect == "__got" || sect == "__la_symbol_ptr") return SectionCategory::Metadata;
    return SectionCategory::Other;
}

std::string MachoParser::demangle(const std::string& mangled) {
    if (mangled.empty()) return mangled;
    const char* raw = mangled.c_str();
    if (raw[0] == '_') ++raw; // Mach-O symbols usually have a leading underscore

#if __has_include(<cxxabi.h>)
    int status = 0;
    char* dem = abi::__cxa_demangle(raw, nullptr, nullptr, &status);
    if (status == 0 && dem) {
        std::string res(dem);
        std::free(dem);
        return res;
    }
#endif
    return mangled.starts_with("_") ? mangled.substr(1) : mangled;
}

std::string MachoParser::template_group(const std::string& demangled) {
    auto start = demangled.find('<');
    if (start == std::string::npos) return demangled;
    auto end = demangled.rfind('>');
    if (end == std::string::npos || end <= start) return demangled;
    return demangled.substr(0, start) + "<...>" + demangled.substr(end + 1);
}

std::expected<MachoParseResult, std::error_code>
MachoParser::parse(std::span<const uint8_t> data, std::string filename) {
    if (data.size() < 32)
        return std::unexpected(make_macho_error(MachoError::TruncatedHeader));

    SpanReader rdr(data);
    auto magic_r = rdr.read_u32_le();
    if (!magic_r) return std::unexpected(magic_r.error());

    uint32_t magic = *magic_r;
    if (magic != kMH_MAGIC_64 && magic != kMH_CIGAM_64) {
        return std::unexpected(make_macho_error(MachoError::BadMagic));
    }

    auto cputype_r    = rdr.read_u32_le(); if (!cputype_r) return std::unexpected(cputype_r.error());
    auto cpusubtype_r = rdr.read_u32_le(); if (!cpusubtype_r) return std::unexpected(cpusubtype_r.error());
    auto filetype_r   = rdr.read_u32_le(); if (!filetype_r) return std::unexpected(filetype_r.error());
    auto ncmds_r      = rdr.read_u32_le(); if (!ncmds_r) return std::unexpected(ncmds_r.error());
    auto sizeofcmds_r = rdr.read_u32_le(); if (!sizeofcmds_r) return std::unexpected(sizeofcmds_r.error());
    auto flags_r      = rdr.read_u32_le(); if (!flags_r) return std::unexpected(flags_r.error());
    auto reserved_r   = rdr.read_u32_le(); if (!reserved_r) return std::unexpected(reserved_r.error());

    MachoParseResult res;
    res.filename    = std::move(filename);
    res.file_size   = data.size();
    res.cpu_type    = *cputype_r;
    res.cpu_subtype = *cpusubtype_r;
    res.file_type   = *filetype_r;

    uint32_t ncmds = *ncmds_r;
    uint32_t symoff = 0, nsyms = 0, stroff = 0, strsize = 0;

    for (uint32_t i = 0; i < ncmds; ++i) {
        size_t cmd_start = rdr.cursor();
        auto cmd_r = rdr.read_u32_le(); if (!cmd_r) break;
        auto cmdsize_r = rdr.read_u32_le(); if (!cmdsize_r) break;
        uint32_t cmd = *cmd_r;
        uint32_t cmdsize = *cmdsize_r;

        if (cmd == kLC_SEGMENT_64) {
            auto segname_bytes = rdr.read_bytes(16);
            if (!segname_bytes) break;
            std::string segname = read_fixed_string(*segname_bytes, 16);

            auto vmaddr_r   = rdr.read_u64_le(); if (!vmaddr_r) break;
            auto vmsize_r   = rdr.read_u64_le(); if (!vmsize_r) break;
            auto fileoff_r  = rdr.read_u64_le(); if (!fileoff_r) break;
            auto filesize_r = rdr.read_u64_le(); if (!filesize_r) break;
            auto maxprot_r  = rdr.read_u32_le(); if (!maxprot_r) break;
            auto initprot_r = rdr.read_u32_le(); if (!initprot_r) break;
            auto nsects_r   = rdr.read_u32_le(); if (!nsects_r) break;
            auto flags_seg  = rdr.read_u32_le(); if (!flags_seg) break;

            uint32_t nsects = *nsects_r;
            for (uint32_t s = 0; s < nsects; ++s) {
                auto sectname_bytes = rdr.read_bytes(16); if (!sectname_bytes) break;
                auto sect_seg_bytes = rdr.read_bytes(16); if (!sect_seg_bytes) break;
                std::string sectname = read_fixed_string(*sectname_bytes, 16);
                std::string s_segname = read_fixed_string(*sect_seg_bytes, 16);

                auto s_addr_r   = rdr.read_u64_le(); if (!s_addr_r) break;
                auto s_size_r   = rdr.read_u64_le(); if (!s_size_r) break;
                auto s_offset_r = rdr.read_u32_le(); if (!s_offset_r) break;
                auto s_align_r  = rdr.read_u32_le(); if (!s_align_r) break;
                auto s_reloff_r = rdr.read_u32_le(); if (!s_reloff_r) break;
                auto s_nreloc_r = rdr.read_u32_le(); if (!s_nreloc_r) break;
                auto s_flags_r  = rdr.read_u32_le(); if (!s_flags_r) break;
                auto s_res1     = rdr.read_u32_le(); if (!s_res1) break;
                auto s_res2     = rdr.read_u32_le(); if (!s_res2) break;
                auto s_res3     = rdr.read_u32_le(); if (!s_res3) break;

                MachoSection sect;
                sect.index = static_cast<uint32_t>(res.sections.size() + 1);
                sect.seg_name = s_segname.empty() ? segname : s_segname;
                sect.sect_name = sectname;
                sect.full_name = sect.seg_name + "." + sect.sect_name;
                sect.addr = *s_addr_r;
                sect.size = *s_size_r;
                sect.offset = *s_offset_r;
                sect.align = *s_align_r;
                sect.flags = *s_flags_r;
                sect.category = classify_section(sect.seg_name, sect.sect_name);

                if (sect.offset + sect.size <= data.size() && sect.size > 0) {
                    res.file_range_map.insert(sect.offset, sect.offset + sect.size,
                                              sect.full_name, AttributionLevel::Section);
                }
                if (sect.size > 0 && sect.category != SectionCategory::Other) {
                    res.vm_range_map.insert(sect.addr, sect.addr + sect.size,
                                            sect.full_name, AttributionLevel::Section);
                }
                res.sections.push_back(std::move(sect));
            }
        } else if (cmd == kLC_SYMTAB) {
            auto symoff_r  = rdr.read_u32_le(); if (symoff_r)  symoff  = *symoff_r;
            auto nsyms_r   = rdr.read_u32_le(); if (nsyms_r)   nsyms   = *nsyms_r;
            auto stroff_r  = rdr.read_u32_le(); if (stroff_r)  stroff  = *stroff_r;
            auto strsize_r = rdr.read_u32_le(); if (strsize_r) strsize = *strsize_r;
        }

        // Advance to next command
        if (cmdsize > 0 && cmd_start + cmdsize <= data.size()) {
            (void)rdr.seek(cmd_start + cmdsize);
        }
    }

    // Parse symbol table if present
    if (symoff > 0 && nsyms > 0 && stroff > 0 && strsize > 0 &&
        symoff + (nsyms * 16) <= data.size() && stroff + strsize <= data.size()) {
        SpanReader sym_rdr(data.subspan(symoff, nsyms * 16));
        SpanReader str_rdr(data.subspan(stroff, strsize));

        for (uint32_t i = 0; i < nsyms; ++i) {
            auto n_strx_r = sym_rdr.read_u32_le(); if (!n_strx_r) break;
            auto n_type_r = sym_rdr.read_u8();     if (!n_type_r) break;
            auto n_sect_r = sym_rdr.read_u8();     if (!n_sect_r) break;
            auto n_desc_r = sym_rdr.read_u16_le(); if (!n_desc_r) break;
            auto n_val_r  = sym_rdr.read_u64_le(); if (!n_val_r) break;

            uint32_t strx = *n_strx_r;
            std::string sym_name;
            if (strx < strsize) {
                auto s_r = str_rdr.read_cstring_at(strx);
                if (s_r) sym_name = std::string(*s_r);
            }

            if (!sym_name.empty() && *n_val_r > 0) {
                MachoSymbol ms;
                ms.raw_name = sym_name;
                ms.demangled_name = demangle(sym_name);
                ms.template_group = template_group(ms.demangled_name);
                ms.value = *n_val_r;
                ms.type = *n_type_r;
                ms.sect = *n_sect_r;

                if (ms.sect > 0 && ms.sect <= res.sections.size()) {
                    ms.section_name = res.sections[ms.sect - 1].full_name;
                }
                res.symbols.push_back(std::move(ms));
            }
        }

        // Sort symbols by value and infer sizes
        std::sort(res.symbols.begin(), res.symbols.end(),
            [](const MachoSymbol& a, const MachoSymbol& b) {
                return a.value < b.value;
            });

        for (size_t i = 0; i < res.symbols.size(); ++i) {
            if (i + 1 < res.symbols.size() && res.symbols[i + 1].value > res.symbols[i].value) {
                res.symbols[i].size = res.symbols[i + 1].value - res.symbols[i].value;
            } else {
                res.symbols[i].size = 32; // fallback nominal size for last symbol
            }

            if (res.symbols[i].size > 0 && res.symbols[i].size < 0x100000) {
                res.vm_range_map.insert(res.symbols[i].value,
                                        res.symbols[i].value + res.symbols[i].size,
                                        res.symbols[i].demangled_name,
                                        AttributionLevel::Symbol,
                                        res.symbols[i].section_name);
            }
        }
    }

    res.file_range_map.fill_gaps(0, res.file_size);
    return res;
}

} // namespace dwarflens
