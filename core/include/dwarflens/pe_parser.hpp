// SPDX-License-Identifier: MIT
// DwarfLens — pe_parser.hpp
// Windows PE/COFF 64-bit binary parser (PE32+ / x86_64, aarch64 .exe and .dll).
#pragma once
#include "span_reader.hpp"
#include "range_map.hpp"
#include "elf_parser.hpp" // for SectionCategory
#include <cstdint>
#include "expected.hpp"
#include <optional>
#include <string>
#include <string_view>
#include <vector>

namespace dwarflens {

struct PeSection {
    uint32_t index{};
    std::string name;
    uint64_t virtual_addr{};
    uint64_t virtual_size{};
    uint64_t raw_offset{};
    uint64_t raw_size{};
    uint32_t characteristics{};
    SectionCategory category{SectionCategory::Other};
};

struct PeSymbol {
    std::string raw_name;
    std::string demangled_name;
    std::string template_group;
    uint64_t value{};
    uint64_t size{};
    std::string section_name;
};

struct PeParseResult {
    std::string filename;
    uint64_t file_size{};
    uint16_t machine{};
    uint16_t characteristics{};
    uint64_t image_base{};
    uint64_t entry_point{};

    std::vector<PeSection> sections;
    std::vector<PeSymbol> symbols;
    RangeMap file_range_map;
    RangeMap vm_range_map;

    [[nodiscard]] const PeSection* find_section(std::string_view name) const {
        for (const auto& s : sections) {
            if (s.name == name) return &s;
        }
        return nullptr;
    }

    [[nodiscard]] std::optional<std::span<const uint8_t>>
    section_data(std::string_view name, std::span<const uint8_t> file_bytes) const {
        const PeSection* s = find_section(name);
        if (!s || s->raw_offset + s->raw_size > file_bytes.size() || s->raw_size == 0)
            return std::nullopt;
        return file_bytes.subspan(static_cast<size_t>(s->raw_offset), static_cast<size_t>(s->raw_size));
    }

    [[nodiscard]] uint64_t total_code_size() const {
        uint64_t sum = 0;
        for (const auto& s : sections)
            if (s.category == SectionCategory::Code) sum += s.raw_size;
        return sum;
    }
    [[nodiscard]] uint64_t total_rodata_size() const {
        uint64_t sum = 0;
        for (const auto& s : sections)
            if (s.category == SectionCategory::ROData) sum += s.raw_size;
        return sum;
    }
    [[nodiscard]] uint64_t total_data_size() const {
        uint64_t sum = 0;
        for (const auto& s : sections)
            if (s.category == SectionCategory::RWData) sum += s.raw_size;
        return sum;
    }
    [[nodiscard]] uint64_t total_bss_size() const {
        uint64_t sum = 0;
        for (const auto& s : sections)
            if (s.category == SectionCategory::BSS) sum += s.virtual_size;
        return sum;
    }
    [[nodiscard]] uint64_t flash_size() const {
        return total_code_size() + total_rodata_size() + total_data_size();
    }
    [[nodiscard]] uint64_t ram_size() const {
        return total_data_size() + total_bss_size();
    }
};

class PeParser {
public:
    static constexpr uint16_t kDOS_MAGIC = 0x5a4d; // 'MZ'
    static constexpr uint32_t kPE_MAGIC  = 0x00004550; // 'PE\0\0'

    [[nodiscard]] static std::expected<PeParseResult, std::error_code>
    parse(std::span<const uint8_t> data, std::string filename = {});

private:
    [[nodiscard]] static SectionCategory classify_section(std::string_view name, uint32_t characteristics);
    [[nodiscard]] static std::string demangle(const std::string& mangled);
    [[nodiscard]] static std::string template_group(const std::string& demangled);
};

} // namespace dwarflens
