// SPDX-License-Identifier: MIT
// DwarfLens — macho_parser.hpp
// 64-bit Mach-O binary parser (macOS x86_64 and arm64).
#pragma once
#include "span_reader.hpp"
#include "range_map.hpp"
#include "elf_parser.hpp" // for SectionCategory
#include <cstdint>
#include <expected>
#include <optional>
#include <string>
#include <string_view>
#include <vector>

namespace dwarflens {

struct MachoSection {
    uint32_t index{};
    std::string seg_name;
    std::string sect_name;
    std::string full_name; // e.g. "__TEXT.__text"
    uint64_t addr{};
    uint64_t size{};
    uint64_t offset{};
    uint32_t align{};
    uint32_t flags{};
    SectionCategory category{SectionCategory::Other};
};

struct MachoSymbol {
    std::string raw_name;
    std::string demangled_name;
    std::string template_group;
    uint64_t value{};
    uint64_t size{};
    uint8_t type{};
    uint8_t sect{};
    std::string section_name;
};

struct MachoParseResult {
    std::string filename;
    uint64_t file_size{};
    uint32_t cpu_type{};
    uint32_t cpu_subtype{};
    uint32_t file_type{};

    std::vector<MachoSection> sections;
    std::vector<MachoSymbol> symbols;
    RangeMap file_range_map;
    RangeMap vm_range_map;

    [[nodiscard]] const MachoSection* find_section(std::string_view name) const {
        for (const auto& s : sections) {
            if (s.full_name == name || s.sect_name == name) return &s;
        }
        return nullptr;
    }

    [[nodiscard]] std::optional<std::span<const uint8_t>>
    section_data(std::string_view name, std::span<const uint8_t> file_bytes) const {
        const MachoSection* s = find_section(name);
        if (!s || s->offset + s->size > file_bytes.size() || s->size == 0)
            return std::nullopt;
        return file_bytes.subspan(static_cast<size_t>(s->offset), static_cast<size_t>(s->size));
    }

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

class MachoParser {
public:
    static constexpr uint32_t kMH_MAGIC_64 = 0xfeedfacf;
    static constexpr uint32_t kMH_CIGAM_64 = 0xcffaedfe;

    [[nodiscard]] static std::expected<MachoParseResult, std::error_code>
    parse(std::span<const uint8_t> data, std::string filename = {});

private:
    [[nodiscard]] static SectionCategory classify_section(std::string_view seg, std::string_view sect);
    [[nodiscard]] static std::string demangle(const std::string& mangled);
    [[nodiscard]] static std::string template_group(const std::string& demangled);
};

} // namespace dwarflens
