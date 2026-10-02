// SPDX-License-Identifier: MIT
// DwarfLens — diff_engine.hpp
// Compute binary and layout deltas between base and target analyses.
#pragma once
#include "elf_parser.hpp"
#include "wasm_parser.hpp"
#include "macho_parser.hpp"
#include "pe_parser.hpp"
#include "struct_layout.hpp"
#include <cstdint>
#include <optional>
#include <string>
#include <variant>
#include <vector>

namespace dwarflens {

// ---------------------------------------------------------------------------
// Combined analysis result — ELF, Wasm, Mach-O, or PE
// ---------------------------------------------------------------------------
struct BinaryAnalysis {
    std::string filename;
    uint64_t    file_size{};
    enum class Format { ELF, Wasm, MachO, PE } format{Format::ELF};

    // ELF-specific
    std::optional<ElfParseResult> elf;
    // Wasm-specific
    std::optional<WasmParseResult> wasm;
    // MachO-specific
    std::optional<MachoParseResult> macho;
    // PE-specific
    std::optional<PeParseResult> pe;
    // Structs (from DWARF)
    std::vector<StructLayout> structs;

    // Unified section summary
    struct SectionSummary {
        std::string name;
        std::string category;
        uint64_t    size{};
        uint64_t    vm_addr{};
    };
    std::vector<SectionSummary> sections;

    // Unified symbol summary
    struct SymbolSummary {
        std::string name;         // demangled
        std::string raw_name;
        std::string section;
        std::string compile_unit;
        std::string template_group;
        uint64_t    size{};
        std::string type;         // "func", "object", "other"
    };
    std::vector<SymbolSummary> symbols;

    // Memory footprint
    uint64_t flash_size{};  // .text + .rodata + .data
    uint64_t ram_size{};    // .data + .bss
};

// ---------------------------------------------------------------------------
// DiffResult
// ---------------------------------------------------------------------------
struct DiffResult {
    std::string base_filename;
    std::string target_filename;

    // Top-level size deltas
    int64_t file_size_delta{};
    int64_t flash_delta{};
    int64_t ram_delta{};

    double file_size_pct{};
    double flash_pct{};
    double ram_pct{};

    // Section deltas
    struct SectionDelta {
        std::string name;
        int64_t     delta_bytes{};
        double      delta_pct{};
        uint64_t    base_size{};
        uint64_t    target_size{};
        enum class Change { Added, Removed, Modified, Unchanged } change{};
    };
    std::vector<SectionDelta> section_deltas;

    // Symbol deltas (top N by absolute change)
    struct SymbolDelta {
        std::string name;
        std::string section;
        std::string template_group;
        int64_t     delta_bytes{};
        uint64_t    base_size{};
        uint64_t    target_size{};
        enum class Change { Added, Removed, Grew, Shrank } change{};
    };
    std::vector<SymbolDelta> symbol_deltas;

    // Struct layout regressions
    struct StructRegression {
        std::string name;
        int64_t     size_delta{};
        int64_t     padding_delta{};
        int64_t     cache_line_delta{};
        bool        is_regression{false}; // true = got worse
    };
    std::vector<StructRegression> struct_regressions;

    // CI threshold checks
    bool exceeded_growth_threshold{false};
    bool has_padding_regression{false};
    int64_t growth_threshold_bytes{-1};
};

// ---------------------------------------------------------------------------
// DiffEngine
// ---------------------------------------------------------------------------
class DiffEngine {
public:
    [[nodiscard]] static DiffResult
    diff(const BinaryAnalysis& base, const BinaryAnalysis& target);

    // Apply CI thresholds and mark failures
    static void apply_thresholds(DiffResult& result,
                                  int64_t max_growth_bytes = -1,
                                  bool fail_on_padding_regression = false);
};

} // namespace dwarflens
