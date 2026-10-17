// SPDX-License-Identifier: MIT
// DwarfLens — wasm_parser.hpp
// WebAssembly binary parser per the WebAssembly Binary Specification §5.
#pragma once
#include "span_reader.hpp"
#include "range_map.hpp"
#include <cstdint>
#include <expected>
#include <string>
#include <vector>

namespace dwarflens {

// ---------------------------------------------------------------------------
// Wasm section IDs (WebAssembly Spec §5.5)
// ---------------------------------------------------------------------------
enum class WasmSectionId : uint8_t {
    Custom   = 0,
    Type     = 1,
    Import   = 2,
    Function = 3,
    Table    = 4,
    Memory   = 5,
    Global   = 6,
    Export   = 7,
    Start    = 8,
    Element  = 9,
    Code     = 10,
    Data     = 11,
    DataCount = 12,
};

struct WasmSection {
    WasmSectionId id;
    std::string   custom_name; // only for id==Custom
    uint64_t      file_offset; // offset of section payload (after id+size)
    uint64_t      payload_size;
    bool          is_debug{false}; // true if custom_name starts with .debug_
};

struct WasmFunction {
    uint32_t    index;          // function index (0-based, imports first)
    std::string name;           // from name section or "func[N]"
    uint64_t    code_offset;    // file offset of code body
    uint64_t    code_size;      // byte size of code body
    bool        is_import{false};
};

struct WasmImport {
    std::string module;
    std::string name;
    uint8_t     kind{}; // 0=func,1=table,2=mem,3=global
};

struct WasmExport {
    std::string name;
    uint8_t     kind{};
    uint32_t    index{};
};

struct WasmParseResult {
    std::string filename;
    uint64_t    file_size{};
    uint32_t    version{};

    std::vector<WasmSection>  sections;
    std::vector<WasmFunction> functions;
    std::vector<WasmImport>   imports;
    std::vector<WasmExport>   exports;
    RangeMap                  file_range_map;

    uint32_t num_types{};
    uint32_t num_tables{};
    uint32_t num_memories{};
    uint32_t num_globals{};
    uint64_t data_section_size{};  // sum of data segments
    uint64_t code_section_size{};  // sum of all code bodies

    // Section lookup by custom name
    [[nodiscard]] const WasmSection* find_custom(std::string_view name) const {
        for (const auto& s : sections)
            if (s.id == WasmSectionId::Custom && s.custom_name == name)
                return &s;
        return nullptr;
    }
};

// ---------------------------------------------------------------------------
// WasmParser
// ---------------------------------------------------------------------------
class WasmParser {
public:
    [[nodiscard]] static std::expected<WasmParseResult, std::error_code>
    parse(std::span<const uint8_t> data, std::string filename = {});

private:
    static constexpr uint8_t kWasmMagic[4] = {0x00, 0x61, 0x73, 0x6D};
    static constexpr uint32_t kWasmVersion = 1;

    [[nodiscard]] static std::expected<void, std::error_code>
    parse_name_section(std::span<const uint8_t> payload,
                       std::vector<WasmFunction>& functions,
                       uint32_t num_imports);
};

} // namespace dwarflens
