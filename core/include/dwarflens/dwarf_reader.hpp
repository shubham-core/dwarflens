// SPDX-License-Identifier: MIT
// DwarfLens — dwarf_reader.hpp
// Custom DWARF v4/v5 DIE walker: extracts struct/class layouts from
// .debug_info, .debug_abbrev, and .debug_str without external libdwarf.
#pragma once
#include "span_reader.hpp"
#include "struct_layout.hpp"
#include <cstdint>
#include <expected>
#include <optional>
#include <string>
#include <unordered_map>
#include <vector>

namespace dwarflens {

// ---------------------------------------------------------------------------
// DWARF constants (subset — enough for struct/member extraction)
// ---------------------------------------------------------------------------
namespace dwarf {
    // Tags
    static constexpr uint16_t DW_TAG_compile_unit    = 0x11;
    static constexpr uint16_t DW_TAG_structure_type  = 0x13;
    static constexpr uint16_t DW_TAG_class_type      = 0x02;
    static constexpr uint16_t DW_TAG_union_type      = 0x17;
    static constexpr uint16_t DW_TAG_member          = 0x0d;
    static constexpr uint16_t DW_TAG_inheritance     = 0x1c;
    static constexpr uint16_t DW_TAG_base_type       = 0x24;
    static constexpr uint16_t DW_TAG_pointer_type    = 0x0f;
    static constexpr uint16_t DW_TAG_reference_type  = 0x10;
    static constexpr uint16_t DW_TAG_array_type      = 0x01;
    static constexpr uint16_t DW_TAG_typedef         = 0x16;
    static constexpr uint16_t DW_TAG_const_type      = 0x26;
    static constexpr uint16_t DW_TAG_volatile_type   = 0x35;
    static constexpr uint16_t DW_TAG_subprogram      = 0x2e;
    static constexpr uint16_t DW_TAG_variable        = 0x34;
    static constexpr uint16_t DW_TAG_enumeration_type = 0x04;
    static constexpr uint16_t DW_TAG_template_type_parameter = 0x2f;

    // Attributes
    static constexpr uint16_t DW_AT_name             = 0x03;
    static constexpr uint16_t DW_AT_byte_size        = 0x0b;
    static constexpr uint16_t DW_AT_bit_offset       = 0x0c;
    static constexpr uint16_t DW_AT_bit_size         = 0x0d;
    static constexpr uint16_t DW_AT_data_member_location = 0x38;
    static constexpr uint16_t DW_AT_type             = 0x49;
    static constexpr uint16_t DW_AT_encoding         = 0x3e;
    static constexpr uint16_t DW_AT_declaration      = 0x3c;
    static constexpr uint16_t DW_AT_alignment        = 0x88;
    static constexpr uint16_t DW_AT_comp_dir         = 0x1b;
    static constexpr uint16_t DW_AT_language         = 0x13;
    static constexpr uint16_t DW_AT_decl_file        = 0x3a;
    static constexpr uint16_t DW_AT_decl_line        = 0x3b;
    static constexpr uint16_t DW_AT_sibling          = 0x01;
    static constexpr uint16_t DW_AT_specification    = 0x47;
    static constexpr uint16_t DW_AT_abstract_origin  = 0x31;

    // Forms
    static constexpr uint8_t DW_FORM_addr       = 0x01;
    static constexpr uint8_t DW_FORM_block1     = 0x0a;
    static constexpr uint8_t DW_FORM_block2     = 0x03;
    static constexpr uint8_t DW_FORM_block4     = 0x04;
    static constexpr uint8_t DW_FORM_block      = 0x09;
    static constexpr uint8_t DW_FORM_data1      = 0x0b;
    static constexpr uint8_t DW_FORM_data2      = 0x05;
    static constexpr uint8_t DW_FORM_data4      = 0x06;
    static constexpr uint8_t DW_FORM_data8      = 0x07;
    static constexpr uint8_t DW_FORM_string     = 0x08;
    static constexpr uint8_t DW_FORM_flag       = 0x0c;
    static constexpr uint8_t DW_FORM_flag_present = 0x19;
    static constexpr uint8_t DW_FORM_ref1       = 0x11;
    static constexpr uint8_t DW_FORM_ref2       = 0x12;
    static constexpr uint8_t DW_FORM_ref4       = 0x13;
    static constexpr uint8_t DW_FORM_ref8       = 0x14;
    static constexpr uint8_t DW_FORM_ref_udata  = 0x15;
    static constexpr uint8_t DW_FORM_ref_addr   = 0x10;
    static constexpr uint8_t DW_FORM_sdata      = 0x0d;
    static constexpr uint8_t DW_FORM_udata      = 0x0f;
    static constexpr uint8_t DW_FORM_strp       = 0x0e;
    static constexpr uint8_t DW_FORM_strp_sup   = 0x1d;
    static constexpr uint8_t DW_FORM_line_strp  = 0x1f;
    static constexpr uint8_t DW_FORM_exprloc    = 0x18;
    static constexpr uint8_t DW_FORM_sec_offset = 0x17;
    static constexpr uint8_t DW_FORM_indirect   = 0x16;
    static constexpr uint8_t DW_FORM_implicit_const = 0x21;
    static constexpr uint8_t DW_FORM_addrx      = 0x1b;
    static constexpr uint8_t DW_FORM_strx       = 0x1a;
    static constexpr uint8_t DW_FORM_loclistx   = 0x22;
    static constexpr uint8_t DW_FORM_rnglistx   = 0x23;

    // Children flag
    static constexpr uint8_t DW_CHILDREN_no  = 0;
    static constexpr uint8_t DW_CHILDREN_yes = 1;

    // Location expression opcodes (for DW_AT_data_member_location)
    static constexpr uint8_t DW_OP_constu = 0x10;
    static constexpr uint8_t DW_OP_plus_uconst = 0x23;
    static constexpr uint8_t DW_OP_fbreg  = 0x77;
    static constexpr uint8_t DW_OP_addr   = 0x03;
} // namespace dwarf

// ---------------------------------------------------------------------------
// DwarfReader
// ---------------------------------------------------------------------------
class DwarfReader {
public:
    struct Input {
        std::span<const uint8_t> debug_info;
        std::span<const uint8_t> debug_abbrev;
        std::span<const uint8_t> debug_str;          // may be empty
        std::span<const uint8_t> debug_line_str;     // DWARF5, may be empty
        bool is_64bit_dwarf{false};
    };

    [[nodiscard]] static std::expected<std::vector<StructLayout>, std::error_code>
    extract_structs(const Input& input);

private:
    // Abbreviation table entry
    struct AbbrevEntry {
        uint64_t code{};
        uint16_t tag{};
        bool     has_children{false};
        struct AttrSpec {
            uint16_t attr;
            uint8_t  form;
            int64_t  implicit_const_value{}; // for DW_FORM_implicit_const
        };
        std::vector<AttrSpec> attrs;
    };

    // Attribute value (discriminated union)
    struct AttrValue {
        enum class Kind { Uint, Int, String, Block, Ref } kind{Kind::Uint};
        uint64_t    uval{};
        int64_t     ival{};
        std::string sval;
        std::vector<uint8_t> block;
    };

    using AbbrevTable = std::unordered_map<uint64_t, AbbrevEntry>;

    [[nodiscard]] static std::expected<AbbrevTable, std::error_code>
    parse_abbrev_table(SpanReader& rdr);

    [[nodiscard]] static std::expected<AttrValue, std::error_code>
    read_attr_value(SpanReader& rdr, uint8_t form, int64_t implicit_const,
                    uint8_t addr_size, bool is_dwarf64,
                    std::span<const uint8_t> debug_str,
                    std::span<const uint8_t> debug_line_str);

    // Skip one attribute value (used for unneeded attributes)
    [[nodiscard]] static std::expected<void, std::error_code>
    skip_attr_value(SpanReader& rdr, uint8_t form, int64_t implicit_const,
                    uint8_t addr_size, bool is_dwarf64);

    // Resolve a type reference (DIE offset) to a type name string
    // (best-effort — may return "unknown")
    struct TypeInfo { std::string name; uint64_t byte_size{}; uint64_t alignment{}; };

    // Walk type DIEs in a CU to build a DIE-offset -> TypeInfo map
    struct DIEContext {
        std::unordered_map<uint64_t, TypeInfo> type_cache;
        std::string compile_unit_name;
        std::string compile_unit_dir;
    };

    // Parse location expression to extract a constant byte offset
    [[nodiscard]] static std::optional<uint64_t>
    decode_location(const AttrValue& val);
};

} // namespace dwarflens
