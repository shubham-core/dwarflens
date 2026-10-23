// SPDX-License-Identifier: MIT
// DwarfLens — pe_parser.cpp
// Windows PE/COFF parser implementation.
#include "dwarflens/pe_parser.hpp"
#include <algorithm>
#if __has_include(<cxxabi.h>)
#  include <cxxabi.h>
#endif
#include <cstdlib>
#include <cstring>
#include <system_error>

namespace dwarflens {

namespace {

enum class PeError : int {
    BadDosMagic = 1,
    BadPeSignature,
    TruncatedHeader,
    TruncatedOptionalHeader,
    TruncatedSectionHeaders,
};

struct PeErrorCategory : std::error_category {
    const char* name() const noexcept override { return "dwarflens.pe"; }
    std::string message(int ev) const override {
        switch (static_cast<PeError>(ev)) {
            case PeError::BadDosMagic: return "not a valid DOS/PE executable (missing MZ header)";
            case PeError::BadPeSignature: return "missing PE\\0\\0 signature";
            case PeError::TruncatedHeader: return "truncated COFF header";
            case PeError::TruncatedOptionalHeader: return "truncated optional header";
            case PeError::TruncatedSectionHeaders: return "truncated section headers";
        }
        return "unknown PE error";
    }
};

const PeErrorCategory& pe_error_category() noexcept {
    static PeErrorCategory cat;
    return cat;
}

std::error_code make_pe_error(PeError e) noexcept {
    return {static_cast<int>(e), pe_error_category()};
}

// Characteristic flags
static constexpr uint32_t kIMAGE_SCN_CNT_CODE               = 0x00000020;
static constexpr uint32_t kIMAGE_SCN_CNT_INITIALIZED_DATA   = 0x00000040;
static constexpr uint32_t kIMAGE_SCN_CNT_UNINITIALIZED_DATA = 0x00000080;
static constexpr uint32_t kIMAGE_SCN_MEM_EXECUTE            = 0x20000000;
static constexpr uint32_t kIMAGE_SCN_MEM_READ               = 0x40000000;
static constexpr uint32_t kIMAGE_SCN_MEM_WRITE              = 0x80000000;

} // anonymous namespace

SectionCategory PeParser::classify_section(std::string_view name, uint32_t characteristics) {
    if (name.starts_with(".debug_") || name == "/4") return SectionCategory::DebugInfo;
    if (name == ".text" || (characteristics & kIMAGE_SCN_MEM_EXECUTE)) return SectionCategory::Code;
    if (name == ".rdata" || name == ".rodata" ||
        ((characteristics & kIMAGE_SCN_MEM_READ) && !(characteristics & kIMAGE_SCN_MEM_WRITE) && !(characteristics & kIMAGE_SCN_MEM_EXECUTE)))
        return SectionCategory::ROData;
    if (name == ".bss" || (characteristics & kIMAGE_SCN_CNT_UNINITIALIZED_DATA)) return SectionCategory::BSS;
    if (name == ".data" || ((characteristics & kIMAGE_SCN_MEM_READ) && (characteristics & kIMAGE_SCN_MEM_WRITE)))
        return SectionCategory::RWData;
    if (name == ".pdata" || name == ".edata" || name == ".idata" || name == ".reloc")
        return SectionCategory::Metadata;
    return SectionCategory::Other;
}

std::string PeParser::demangle(const std::string& mangled) {
    if (mangled.empty()) return mangled;
#if __has_include(<cxxabi.h>)
    int status = 0;
    char* dem = abi::__cxa_demangle(mangled.c_str(), nullptr, nullptr, &status);
    if (status == 0 && dem) {
        std::string res(dem);
        std::free(dem);
        return res;
    }
#endif
    return mangled;
}

std::string PeParser::template_group(const std::string& demangled) {
    auto start = demangled.find('<');
    if (start == std::string::npos) return demangled;
    auto end = demangled.rfind('>');
    if (end == std::string::npos || end <= start) return demangled;
    return demangled.substr(0, start) + "<...>" + demangled.substr(end + 1);
}

std::expected<PeParseResult, std::error_code>
PeParser::parse(std::span<const uint8_t> data, std::string filename) {
    if (data.size() < 64)
        return std::unexpected(make_pe_error(PeError::TruncatedHeader));

    SpanReader rdr(data);
    auto dos_magic_r = rdr.read_u16_le();
    if (!dos_magic_r) return std::unexpected(dos_magic_r.error());
    if (*dos_magic_r != kDOS_MAGIC)
        return std::unexpected(make_pe_error(PeError::BadDosMagic));

    // Seek to e_lfanew at 0x3C
    if (!rdr.seek(0x3C))
        return std::unexpected(make_pe_error(PeError::TruncatedHeader));

    auto pe_offset_r = rdr.read_u32_le();
    if (!pe_offset_r) return std::unexpected(pe_offset_r.error());
    uint32_t pe_offset = *pe_offset_r;

    if (pe_offset + 24 > data.size())
        return std::unexpected(make_pe_error(PeError::TruncatedHeader));

    if (!rdr.seek(pe_offset))
        return std::unexpected(make_pe_error(PeError::TruncatedHeader));

    // Read PE signature 'PE\0\0'
    auto pe_sig_r = rdr.read_u32_le();
    if (!pe_sig_r) return std::unexpected(pe_sig_r.error());
    if (*pe_sig_r != kPE_MAGIC)
        return std::unexpected(make_pe_error(PeError::BadPeSignature));

    // Read COFF File Header (20 bytes)
    auto machine_r     = rdr.read_u16_le(); if (!machine_r) return std::unexpected(machine_r.error());
    auto num_sects_r   = rdr.read_u16_le(); if (!num_sects_r) return std::unexpected(num_sects_r.error());
    auto timestamp_r   = rdr.read_u32_le(); if (!timestamp_r) return std::unexpected(timestamp_r.error());
    auto sym_ptr_r     = rdr.read_u32_le(); if (!sym_ptr_r) return std::unexpected(sym_ptr_r.error());
    auto num_syms_r    = rdr.read_u32_le(); if (!num_syms_r) return std::unexpected(num_syms_r.error());
    auto opt_hdr_len_r = rdr.read_u16_le(); if (!opt_hdr_len_r) return std::unexpected(opt_hdr_len_r.error());
    auto charact_r     = rdr.read_u16_le(); if (!charact_r) return std::unexpected(charact_r.error());

    PeParseResult res;
    res.filename        = std::move(filename);
    res.file_size       = data.size();
    res.machine         = *machine_r;
    res.characteristics = *charact_r;

    uint16_t num_sects = *num_sects_r;
    uint16_t opt_hdr_len = *opt_hdr_len_r;
    size_t opt_hdr_start = rdr.cursor();

    // Parse Optional Header (PE32 or PE32+)
    if (opt_hdr_len >= 24) {
        auto opt_magic_r = rdr.read_u16_le();
        if (opt_magic_r) {
            uint16_t opt_magic = *opt_magic_r;
            // 0x10b = PE32 (32-bit), 0x20b = PE32+ (64-bit)
            (void)rdr.skip(14); // MajorLinkerVersion .. BaseOfCode
            auto entry_r = rdr.read_u32_le();
            if (entry_r) res.entry_point = *entry_r;

            if (opt_magic == 0x20b) { // 64-bit
                (void)rdr.skip(4); // BaseOfData (absent in 64-bit) / align
                auto img_base_r = rdr.read_u64_le();
                if (img_base_r) res.image_base = *img_base_r;
            } else { // 32-bit
                (void)rdr.skip(4);
                auto img_base_r = rdr.read_u32_le();
                if (img_base_r) res.image_base = *img_base_r;
            }
        }
    }

    // Seek to section headers
    if (!rdr.seek(opt_hdr_start + opt_hdr_len))
        return std::unexpected(make_pe_error(PeError::TruncatedSectionHeaders));

    for (uint16_t i = 0; i < num_sects; ++i) {
        auto name_bytes_r = rdr.read_bytes(8);
        if (!name_bytes_r) break;

        size_t len = 0;
        while (len < 8 && (*name_bytes_r)[len] != 0) ++len;
        std::string sect_name(reinterpret_cast<const char*>(name_bytes_r->data()), len);

        auto virt_size_r = rdr.read_u32_le(); if (!virt_size_r) break;
        auto virt_addr_r = rdr.read_u32_le(); if (!virt_addr_r) break;
        auto raw_size_r  = rdr.read_u32_le(); if (!raw_size_r) break;
        auto raw_ptr_r   = rdr.read_u32_le(); if (!raw_ptr_r) break;
        (void)rdr.skip(12); // relocs, line nums
        auto charact_sect_r = rdr.read_u32_le(); if (!charact_sect_r) break;

        PeSection s;
        s.index           = i + 1;
        s.name            = std::move(sect_name);
        s.virtual_size    = *virt_size_r;
        s.virtual_addr    = *virt_addr_r;
        s.raw_size        = *raw_size_r;
        s.raw_offset      = *raw_ptr_r;
        s.characteristics = *charact_sect_r;
        s.category        = classify_section(s.name, s.characteristics);

        if (s.raw_offset + s.raw_size <= data.size() && s.raw_size > 0) {
            res.file_range_map.insert(s.raw_offset, s.raw_offset + s.raw_size,
                                      s.name, AttributionLevel::Section);
        }
        if (s.virtual_size > 0) {
            uint64_t vm_start = res.image_base + s.virtual_addr;
            res.vm_range_map.insert(vm_start, vm_start + s.virtual_size,
                                    s.name, AttributionLevel::Section);
        }
        res.sections.push_back(std::move(s));
    }

    res.file_range_map.fill_gaps(0, res.file_size);
    return res;
}

} // namespace dwarflens
