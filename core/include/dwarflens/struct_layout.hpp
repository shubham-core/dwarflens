// SPDX-License-Identifier: MIT
// DwarfLens — struct_layout.hpp
// DWARF-extracted struct/class memory layout with padding and cache-line analysis.
#pragma once
#include <cstdint>
#include <optional>
#include <string>
#include <vector>

namespace dwarflens {

static constexpr uint64_t kCacheLineSize = 64;

// ---------------------------------------------------------------------------
// StructMember — one field extracted from DWARF
// ---------------------------------------------------------------------------
struct StructMember {
    std::string name;
    std::string type_name;
    uint64_t    offset{};       // DW_AT_data_member_location
    uint64_t    byte_size{};    // size of this member in bytes
    uint64_t    alignment{};    // alignment requirement
    bool        is_bitfield{false};
    uint32_t    bit_offset{};
    uint32_t    bit_size{};
    bool        is_base_class{false}; // DW_TAG_inheritance
};

// ---------------------------------------------------------------------------
// PaddingHole — a gap between two consecutive members
// ---------------------------------------------------------------------------
struct PaddingHole {
    uint64_t offset;    // start of padding
    uint64_t size;      // bytes of padding
    std::string before; // member before the hole (or "[start]")
    std::string after;  // member after the hole (or "[end]")
};

// ---------------------------------------------------------------------------
// CacheLineCrossing — a member that straddles a 64-byte boundary
// ---------------------------------------------------------------------------
struct CacheLineCrossing {
    std::string member_name;
    uint64_t    member_offset;
    uint64_t    member_size;
    uint64_t    boundary; // the cache-line boundary crossed
};

// ---------------------------------------------------------------------------
// StructLayout — complete layout information for one struct/class
// ---------------------------------------------------------------------------
struct StructLayout {
    std::string name;
    std::string source_file;
    uint32_t    source_line{};
    std::string tag;             // "struct" or "class"

    uint64_t byte_size{};        // compiler-reported total size (with tail padding)
    uint64_t alignment{};        // struct alignment requirement

    std::vector<StructMember>      members;
    std::vector<PaddingHole>       padding_holes;
    std::vector<CacheLineCrossing> cache_line_crossings;

    uint64_t total_padding_bytes{};   // sum of all hole sizes
    uint64_t useful_bytes{};          // byte_size - total_padding_bytes
    uint32_t cache_lines_spanned{};   // ceil(byte_size / 64)

    // Optimal reordering result
    struct OptimalLayout {
        std::vector<StructMember> members; // reordered
        uint64_t byte_size{};
        uint64_t bytes_saved{};
        std::string cpp_snippet;   // copy-pasteable C/C++ struct
        std::string rust_snippet;  // copy-pasteable Rust struct
    };
    std::optional<OptimalLayout> optimal;

    // Summary helpers
    [[nodiscard]] bool has_padding() const { return total_padding_bytes > 0; }
    [[nodiscard]] bool has_cache_line_crossing() const {
        return !cache_line_crossings.empty();
    }
    [[nodiscard]] double padding_fraction() const {
        if (byte_size == 0) return 0.0;
        return static_cast<double>(total_padding_bytes) /
               static_cast<double>(byte_size);
    }
};

// ---------------------------------------------------------------------------
// LayoutAnalyzer — computes diagnostics for a list of StructLayouts
// ---------------------------------------------------------------------------
class LayoutAnalyzer {
public:
    // Compute padding holes, cache-line crossings, and optimal reordering
    // in-place for a single struct layout.
    static void analyze(StructLayout& layout);

    // Batch analyze a list
    static void analyze_all(std::vector<StructLayout>& layouts) {
        for (auto& l : layouts) analyze(l);
    }

private:
    static void compute_padding(StructLayout& layout);
    static void compute_cache_lines(StructLayout& layout);
    static void compute_optimal(StructLayout& layout);

    // Generate optimal C struct snippet
    [[nodiscard]] static std::string generate_cpp_snippet(
        const std::string& name,
        const std::string& tag,
        const std::vector<StructMember>& members);

    // Generate optimal Rust struct snippet
    [[nodiscard]] static std::string generate_rust_snippet(
        const std::string& name,
        const std::vector<StructMember>& members);
};

} // namespace dwarflens
