// SPDX-License-Identifier: MIT
// DwarfLens — dwarf_reader.cpp
// Custom DWARF v4/v5 DIE walker extracting struct/class layouts with full
// two-pass type resolution (supporting forward references, typedef chains, and array types).
#include "dwarflens/dwarf_reader.hpp"
#include <algorithm>
#include <cstring>
#include <stack>
#include <unordered_map>
#include <sstream>

namespace dwarflens {

namespace {

// Standard fallback sizes for fundamental C/C++ types
[[nodiscard]] uint64_t fallback_type_size(const std::string& name) noexcept {
    if (name.empty()) return 0;
    if (name.back() == '*') return 8; // pointer
    if (name == "char" || name == "signed char" || name == "unsigned char" ||
        name == "int8_t" || name == "uint8_t" || name == "bool" || name == "_Bool") return 1;
    if (name == "short" || name == "short int" || name == "unsigned short" ||
        name == "int16_t" || name == "uint16_t") return 2;
    if (name == "int" || name == "signed int" || name == "unsigned int" ||
        name == "int32_t" || name == "uint32_t" || name == "float") return 4;
    if (name == "long" || name == "long int" || name == "unsigned long" ||
        name == "long long" || name == "unsigned long long" ||
        name == "int64_t" || name == "uint64_t" || name == "double" ||
        name == "size_t" || name == "uintptr_t" || name == "intptr_t" ||
        name == "ssize_t" || name == "ptrdiff_t") return 8;
    if (name == "__int128" || name == "unsigned __int128" || name == "long double") return 16;
    return 0;
}

} // anonymous namespace

// ---------------------------------------------------------------------------
// Parse abbreviation table from .debug_abbrev at given offset
// ---------------------------------------------------------------------------
std::expected<DwarfReader::AbbrevTable, std::error_code>
DwarfReader::parse_abbrev_table(SpanReader& rdr) {
    AbbrevTable table;
    while (!rdr.empty()) {
        auto code_res = rdr.read_uleb128();
        if (!code_res) return std::unexpected(code_res.error());
        uint64_t code = *code_res;
        if (code == 0) break; // end of table

        auto tag_res = rdr.read_uleb128();
        if (!tag_res) return std::unexpected(tag_res.error());

        auto children_res = rdr.read_u8();
        if (!children_res) return std::unexpected(children_res.error());

        AbbrevEntry entry;
        entry.code = code;
        entry.tag = static_cast<uint16_t>(*tag_res);
        entry.has_children = (*children_res == dwarf::DW_CHILDREN_yes);

        // Read attribute specs until (0, 0) sentinel
        while (true) {
            auto attr_res = rdr.read_uleb128();
            if (!attr_res) return std::unexpected(attr_res.error());
            auto form_res = rdr.read_uleb128();
            if (!form_res) return std::unexpected(form_res.error());

            uint64_t attr = *attr_res;
            uint64_t form = *form_res;
            if (attr == 0 && form == 0) break;

            AbbrevEntry::AttrSpec spec;
            spec.attr = static_cast<uint16_t>(attr);
            spec.form = static_cast<uint8_t>(form);

            if (form == dwarf::DW_FORM_implicit_const) {
                auto cv = rdr.read_sleb128();
                if (!cv) return std::unexpected(cv.error());
                spec.implicit_const_value = *cv;
            }
            entry.attrs.push_back(spec);
        }
        table[code] = std::move(entry);
    }
    return table;
}

// ---------------------------------------------------------------------------
// Read one attribute value
// ---------------------------------------------------------------------------
std::expected<DwarfReader::AttrValue, std::error_code>
DwarfReader::read_attr_value(SpanReader& rdr, uint8_t form,
                             int64_t implicit_const,
                             uint8_t addr_size, bool is_dwarf64,
                             std::span<const uint8_t> debug_str,
                             std::span<const uint8_t> debug_line_str) {
    AttrValue val;
    switch (form) {
        case dwarf::DW_FORM_data1: {
            auto r = rdr.read_u8(); if (!r) return std::unexpected(r.error());
            val.kind = AttrValue::Kind::Uint; val.uval = *r; break;
        }
        case dwarf::DW_FORM_data2: {
            auto r = rdr.read_u16_le(); if (!r) return std::unexpected(r.error());
            val.kind = AttrValue::Kind::Uint; val.uval = *r; break;
        }
        case dwarf::DW_FORM_data4: {
            auto r = rdr.read_u32_le(); if (!r) return std::unexpected(r.error());
            val.kind = AttrValue::Kind::Uint; val.uval = *r; break;
        }
        case dwarf::DW_FORM_data8: {
            auto r = rdr.read_u64_le(); if (!r) return std::unexpected(r.error());
            val.kind = AttrValue::Kind::Uint; val.uval = *r; break;
        }
        case dwarf::DW_FORM_udata: {
            auto r = rdr.read_uleb128(); if (!r) return std::unexpected(r.error());
            val.kind = AttrValue::Kind::Uint; val.uval = *r; break;
        }
        case dwarf::DW_FORM_sdata: {
            auto r = rdr.read_sleb128(); if (!r) return std::unexpected(r.error());
            val.kind = AttrValue::Kind::Int; val.ival = *r; break;
        }
        case dwarf::DW_FORM_implicit_const: {
            val.kind = AttrValue::Kind::Int; val.ival = implicit_const; break;
        }
        case dwarf::DW_FORM_addr: {
            if (addr_size == 8) {
                auto r = rdr.read_u64_le(); if (!r) return std::unexpected(r.error());
                val.kind = AttrValue::Kind::Uint; val.uval = *r;
            } else {
                auto r = rdr.read_u32_le(); if (!r) return std::unexpected(r.error());
                val.kind = AttrValue::Kind::Uint; val.uval = *r;
            }
            break;
        }
        case dwarf::DW_FORM_string: {
            auto r = rdr.read_cstring(); if (!r) return std::unexpected(r.error());
            val.kind = AttrValue::Kind::String; val.sval = std::string(*r); break;
        }
        case dwarf::DW_FORM_strp: {
            uint64_t offset = 0;
            if (is_dwarf64) {
                auto r = rdr.read_u64_le(); if (!r) return std::unexpected(r.error());
                offset = *r;
            } else {
                auto r = rdr.read_u32_le(); if (!r) return std::unexpected(r.error());
                offset = *r;
            }
            val.kind = AttrValue::Kind::String;
            if (!debug_str.empty() && offset < debug_str.size()) {
                SpanReader sr(debug_str);
                auto skip = sr.skip(static_cast<size_t>(offset));
                if (skip) {
                    auto r = sr.read_cstring();
                    if (r) val.sval = std::string(*r);
                }
            }
            break;
        }
        case dwarf::DW_FORM_line_strp: {
            uint64_t offset = 0;
            if (is_dwarf64) {
                auto r = rdr.read_u64_le(); if (!r) return std::unexpected(r.error());
                offset = *r;
            } else {
                auto r = rdr.read_u32_le(); if (!r) return std::unexpected(r.error());
                offset = *r;
            }
            val.kind = AttrValue::Kind::String;
            if (!debug_line_str.empty() && offset < debug_line_str.size()) {
                SpanReader sr(debug_line_str);
                auto skip = sr.skip(static_cast<size_t>(offset));
                if (skip) {
                    auto r = sr.read_cstring();
                    if (r) val.sval = std::string(*r);
                }
            }
            break;
        }
        case dwarf::DW_FORM_ref1: {
            auto r = rdr.read_u8(); if (!r) return std::unexpected(r.error());
            val.kind = AttrValue::Kind::Ref; val.uval = *r; break;
        }
        case dwarf::DW_FORM_ref2: {
            auto r = rdr.read_u16_le(); if (!r) return std::unexpected(r.error());
            val.kind = AttrValue::Kind::Ref; val.uval = *r; break;
        }
        case dwarf::DW_FORM_ref4: {
            auto r = rdr.read_u32_le(); if (!r) return std::unexpected(r.error());
            val.kind = AttrValue::Kind::Ref; val.uval = *r; break;
        }
        case dwarf::DW_FORM_ref8: {
            auto r = rdr.read_u64_le(); if (!r) return std::unexpected(r.error());
            val.kind = AttrValue::Kind::Ref; val.uval = *r; break;
        }
        case dwarf::DW_FORM_ref_udata: {
            auto r = rdr.read_uleb128(); if (!r) return std::unexpected(r.error());
            val.kind = AttrValue::Kind::Ref; val.uval = *r; break;
        }
        case dwarf::DW_FORM_ref_addr: {
            if (is_dwarf64) {
                auto r = rdr.read_u64_le(); if (!r) return std::unexpected(r.error());
                val.kind = AttrValue::Kind::Uint; val.uval = *r;
            } else {
                auto r = rdr.read_u32_le(); if (!r) return std::unexpected(r.error());
                val.kind = AttrValue::Kind::Uint; val.uval = *r;
            }
            break;
        }
        case dwarf::DW_FORM_flag: {
            auto r = rdr.read_u8(); if (!r) return std::unexpected(r.error());
            val.kind = AttrValue::Kind::Uint; val.uval = *r; break;
        }
        case dwarf::DW_FORM_flag_present: {
            val.kind = AttrValue::Kind::Uint; val.uval = 1; break;
        }
        case dwarf::DW_FORM_exprloc:
        case dwarf::DW_FORM_block: {
            auto len_r = rdr.read_uleb128();
            if (!len_r) return std::unexpected(len_r.error());
            auto bytes_r = rdr.read_bytes(static_cast<size_t>(*len_r));
            if (!bytes_r) return std::unexpected(bytes_r.error());
            val.kind = AttrValue::Kind::Block;
            val.block.assign(bytes_r->begin(), bytes_r->end());
            break;
        }
        case dwarf::DW_FORM_block1: {
            auto len_r = rdr.read_u8(); if (!len_r) return std::unexpected(len_r.error());
            auto bytes_r = rdr.read_bytes(*len_r);
            if (!bytes_r) return std::unexpected(bytes_r.error());
            val.kind = AttrValue::Kind::Block;
            val.block.assign(bytes_r->begin(), bytes_r->end());
            break;
        }
        case dwarf::DW_FORM_block2: {
            auto len_r = rdr.read_u16_le(); if (!len_r) return std::unexpected(len_r.error());
            auto bytes_r = rdr.read_bytes(*len_r);
            if (!bytes_r) return std::unexpected(bytes_r.error());
            val.kind = AttrValue::Kind::Block;
            val.block.assign(bytes_r->begin(), bytes_r->end());
            break;
        }
        case dwarf::DW_FORM_block4: {
            auto len_r = rdr.read_u32_le(); if (!len_r) return std::unexpected(len_r.error());
            auto bytes_r = rdr.read_bytes(*len_r);
            if (!bytes_r) return std::unexpected(bytes_r.error());
            val.kind = AttrValue::Kind::Block;
            val.block.assign(bytes_r->begin(), bytes_r->end());
            break;
        }
        case dwarf::DW_FORM_sec_offset: {
            if (is_dwarf64) {
                auto r = rdr.read_u64_le(); if (!r) return std::unexpected(r.error());
                val.kind = AttrValue::Kind::Uint; val.uval = *r;
            } else {
                auto r = rdr.read_u32_le(); if (!r) return std::unexpected(r.error());
                val.kind = AttrValue::Kind::Uint; val.uval = *r;
            }
            break;
        }
        case dwarf::DW_FORM_addrx:
        case dwarf::DW_FORM_strx:
        case dwarf::DW_FORM_loclistx:
        case dwarf::DW_FORM_rnglistx: {
            auto r = rdr.read_uleb128(); if (!r) return std::unexpected(r.error());
            val.kind = AttrValue::Kind::Uint; val.uval = *r; break;
        }
        case dwarf::DW_FORM_indirect: {
            auto form_r = rdr.read_uleb128(); if (!form_r) return std::unexpected(form_r.error());
            return read_attr_value(rdr, static_cast<uint8_t>(*form_r), implicit_const,
                                   addr_size, is_dwarf64, debug_str, debug_line_str);
        }
        default: {
            val.kind = AttrValue::Kind::Uint; val.uval = 0; break;
        }
    }
    return val;
}

// ---------------------------------------------------------------------------
// Decode a DW_AT_data_member_location value to a byte offset
// ---------------------------------------------------------------------------
std::optional<uint64_t> DwarfReader::decode_location(const AttrValue& val) {
    if (val.kind == AttrValue::Kind::Uint || val.kind == AttrValue::Kind::Ref) {
        return val.uval;
    }
    if (val.kind == AttrValue::Kind::Int && val.ival >= 0) {
        return static_cast<uint64_t>(val.ival);
    }
    if (val.kind == AttrValue::Kind::Block && !val.block.empty()) {
        SpanReader expr(std::span<const uint8_t>(val.block));
        auto op_r = expr.read_u8();
        if (!op_r) return std::nullopt;
        uint8_t op = *op_r;
        if (op == dwarf::DW_OP_plus_uconst || op == dwarf::DW_OP_constu) {
            auto uv = expr.read_uleb128();
            if (uv) return *uv;
        }
        if (op == dwarf::DW_OP_addr) {
            auto uv = expr.read_u64_le();
            if (uv) return *uv;
        }
        if (op < 0x10) return static_cast<uint64_t>(op);
    }
    return std::nullopt;
}

// ---------------------------------------------------------------------------
// Main extraction entry point with Two-Pass DIE processing
// ---------------------------------------------------------------------------
std::expected<std::vector<StructLayout>, std::error_code>
DwarfReader::extract_structs(const Input& input) {
    if (input.debug_info.empty() || input.debug_abbrev.empty())
        return std::vector<StructLayout>{};

    std::vector<StructLayout> result;
    SpanReader info_rdr(input.debug_info);

    // Raw DIE representation for two-pass processing
    struct RawAttr {
        uint16_t attr;
        AttrValue val;
    };
    struct RawDIE {
        uint64_t offset;
        uint16_t tag;
        bool has_children;
        std::vector<RawAttr> attrs;
    };

    struct CUInfo {
        size_t cu_start;
        size_t cu_end;
        uint16_t version;
        uint8_t addr_size;
        bool is_dwarf64;
        uint64_t abbrev_offset;
        AbbrevTable abbrev_table;
        std::vector<RawDIE> dies;
        std::string cu_name;
    };

    std::vector<CUInfo> cus;

    // ---------------------------------------------------------------------------
    // STEP 1: Parse all CUs and read all DIEs into memory
    // ---------------------------------------------------------------------------
    while (!info_rdr.empty()) {
        const size_t cu_start_offset = info_rdr.cursor();

        auto unit_length_32_r = info_rdr.read_u32_le();
        if (!unit_length_32_r) break;

        bool is_dwarf64 = false;
        uint64_t unit_length = 0;
        if (*unit_length_32_r == 0xFFFFFFFF) {
            is_dwarf64 = true;
            auto r = info_rdr.read_u64_le();
            if (!r) break;
            unit_length = *r;
        } else {
            unit_length = *unit_length_32_r;
        }

        const size_t cu_header_start = info_rdr.cursor();
        const size_t cu_end = cu_header_start + static_cast<size_t>(unit_length);
        if (cu_end > input.debug_info.size()) break;

        auto version_r = info_rdr.read_u16_le();
        if (!version_r) break;
        uint16_t dwarf_version = *version_r;

        uint64_t abbrev_offset = 0;
        uint8_t addr_size = 8;

        if (dwarf_version >= 5) {
            auto ut_r = info_rdr.read_u8(); if (!ut_r) break;
            auto as_r = info_rdr.read_u8(); if (!as_r) break;
            addr_size = *as_r;
            if (is_dwarf64) {
                auto r = info_rdr.read_u64_le(); if (!r) break; abbrev_offset = *r;
            } else {
                auto r = info_rdr.read_u32_le(); if (!r) break; abbrev_offset = *r;
            }
        } else {
            if (is_dwarf64) {
                auto r = info_rdr.read_u64_le(); if (!r) break; abbrev_offset = *r;
            } else {
                auto r = info_rdr.read_u32_le(); if (!r) break; abbrev_offset = *r;
            }
            auto as_r = info_rdr.read_u8(); if (!as_r) break;
            addr_size = *as_r;
        }

        if (abbrev_offset >= input.debug_abbrev.size()) {
            if (info_rdr.seek(cu_end).has_value()) continue; else break;
        }

        SpanReader abbrev_rdr(input.debug_abbrev.subspan(static_cast<size_t>(abbrev_offset)));
        auto abbrev_table_r = parse_abbrev_table(abbrev_rdr);
        if (!abbrev_table_r) {
            if (info_rdr.seek(cu_end).has_value()) continue; else break;
        }

        CUInfo cu;
        cu.cu_start = cu_start_offset;
        cu.cu_end = cu_end;
        cu.version = dwarf_version;
        cu.addr_size = addr_size;
        cu.is_dwarf64 = is_dwarf64;
        cu.abbrev_offset = abbrev_offset;
        cu.abbrev_table = std::move(*abbrev_table_r);

        while (info_rdr.cursor() < cu_end) {
            const uint64_t die_offset = static_cast<uint64_t>(info_rdr.cursor());
            auto code_r = info_rdr.read_uleb128();
            if (!code_r) break;
            uint64_t code = *code_r;

            if (code == 0) {
                // Null terminator entry
                cu.dies.push_back(RawDIE{die_offset, 0, false, {}});
                continue;
            }

            auto it = cu.abbrev_table.find(code);
            if (it == cu.abbrev_table.end()) break;
            const auto& abbrev = it->second;

            RawDIE die;
            die.offset = die_offset;
            die.tag = abbrev.tag;
            die.has_children = abbrev.has_children;
            die.attrs.reserve(abbrev.attrs.size());

            for (const auto& spec : abbrev.attrs) {
                auto val_r = read_attr_value(info_rdr, spec.form, spec.implicit_const_value,
                                             addr_size, is_dwarf64, input.debug_str, input.debug_line_str);
                if (!val_r) break;
                die.attrs.push_back(RawAttr{spec.attr, std::move(*val_r)});
            }
            cu.dies.push_back(std::move(die));
        }

        cus.push_back(std::move(cu));
        auto seek_r = info_rdr.seek(cu_end);
        if (!seek_r) break;
    }

    // ---------------------------------------------------------------------------
    // STEP 2: Index all type definitions across all CUs
    // ---------------------------------------------------------------------------
    struct RawTypeInfo {
        uint16_t tag{};
        std::string name;
        uint64_t byte_size{};
        uint64_t alignment{};
        uint64_t type_ref{UINT64_MAX};
        uint64_t count{1};
    };

    std::unordered_map<uint64_t, RawTypeInfo> raw_types;

    for (auto& cu : cus) {
        // Track parent array DIE to assign subrange bounds
        std::vector<uint64_t> array_die_stack;

        for (const auto& die : cu.dies) {
            if (die.tag == 0) {
                if (!array_die_stack.empty()) array_die_stack.pop_back();
                continue;
            }

            std::string name;
            uint64_t byte_size = 0;
            uint64_t alignment = 0;
            uint64_t type_ref = UINT64_MAX;
            uint64_t upper_bound = UINT64_MAX;
            uint64_t count_val = UINT64_MAX;

            for (const auto& [attr, v] : die.attrs) {
                if (attr == dwarf::DW_AT_name && v.kind == AttrValue::Kind::String) {
                    name = v.sval;
                } else if (attr == dwarf::DW_AT_byte_size) {
                    byte_size = (v.kind == AttrValue::Kind::Uint) ? v.uval : static_cast<uint64_t>(v.ival);
                } else if (attr == dwarf::DW_AT_alignment && v.kind == AttrValue::Kind::Uint) {
                    alignment = v.uval;
                } else if (attr == dwarf::DW_AT_type) {
                    if (v.kind == AttrValue::Kind::Ref) {
                        type_ref = cu.cu_start + v.uval;
                    } else if (v.kind == AttrValue::Kind::Uint) {
                        type_ref = v.uval;
                    }
                } else if (attr == 0x2f /* DW_AT_upper_bound */) {
                    upper_bound = (v.kind == AttrValue::Kind::Uint) ? v.uval : static_cast<uint64_t>(v.ival);
                } else if (attr == 0x37 /* DW_AT_count */) {
                    count_val = (v.kind == AttrValue::Kind::Uint) ? v.uval : static_cast<uint64_t>(v.ival);
                }
            }

            if (die.tag == 0x21 /* DW_TAG_subrange_type */) {
                if (!array_die_stack.empty()) {
                    uint64_t parent_offset = array_die_stack.back();
                    uint64_t total_count = 1;
                    if (count_val != UINT64_MAX) total_count = count_val;
                    else if (upper_bound != UINT64_MAX) total_count = upper_bound + 1;
                    raw_types[parent_offset].count = total_count;
                }
            }

            // Save type information
            if (die.tag == dwarf::DW_TAG_base_type ||
                die.tag == dwarf::DW_TAG_typedef ||
                die.tag == dwarf::DW_TAG_pointer_type ||
                die.tag == dwarf::DW_TAG_reference_type ||
                die.tag == dwarf::DW_TAG_const_type ||
                die.tag == dwarf::DW_TAG_volatile_type ||
                die.tag == dwarf::DW_TAG_array_type ||
                die.tag == dwarf::DW_TAG_structure_type ||
                die.tag == dwarf::DW_TAG_class_type ||
                die.tag == dwarf::DW_TAG_union_type ||
                die.tag == dwarf::DW_TAG_enumeration_type) {
                raw_types[die.offset] = RawTypeInfo{
                    .tag = die.tag,
                    .name = name,
                    .byte_size = byte_size,
                    .alignment = alignment ? alignment : byte_size,
                    .type_ref = type_ref,
                    .count = 1
                };
            }

            if (die.tag == dwarf::DW_TAG_array_type && die.has_children) {
                array_die_stack.push_back(die.offset);
            }
        }
    }

    // ---------------------------------------------------------------------------
    // STEP 3: Resolve type definitions with recursive memoization
    // ---------------------------------------------------------------------------
    std::unordered_map<uint64_t, TypeInfo> global_type_cache;

    auto resolve_type = [&](auto& self, uint64_t offset, int depth) -> TypeInfo {
        if (depth > 20) return {"unknown", 0, 0};
        auto cached = global_type_cache.find(offset);
        if (cached != global_type_cache.end()) return cached->second;

        auto raw_it = raw_types.find(offset);
        if (raw_it == raw_types.end()) return {"unknown", 0, 0};
        const auto& raw = raw_it->second;

        TypeInfo info;
        info.name = raw.name;
        info.byte_size = raw.byte_size;
        info.alignment = raw.alignment;

        if (raw.tag == dwarf::DW_TAG_pointer_type || raw.tag == dwarf::DW_TAG_reference_type) {
            if (info.byte_size == 0) info.byte_size = 8;
            if (info.alignment == 0) info.alignment = 8;
            if (raw.type_ref != UINT64_MAX) {
                auto pointee = self(self, raw.type_ref, depth + 1);
                if (!pointee.name.empty()) info.name = pointee.name + "*";
            }
            if (info.name.empty()) info.name = "void*";
        } else if (raw.tag == dwarf::DW_TAG_array_type) {
            if (raw.type_ref != UINT64_MAX) {
                auto elem = self(self, raw.type_ref, depth + 1);
                info.name = elem.name + "[" + std::to_string(raw.count) + "]";
                if (info.byte_size == 0) info.byte_size = elem.byte_size * raw.count;
                if (info.alignment == 0) info.alignment = elem.alignment;
            }
        } else if (raw.type_ref != UINT64_MAX) {
            auto underlying = self(self, raw.type_ref, depth + 1);
            if (info.name.empty()) info.name = underlying.name;
            if (info.byte_size == 0) info.byte_size = underlying.byte_size;
            if (info.alignment == 0) info.alignment = underlying.alignment;
        }

        if (info.byte_size == 0) {
            info.byte_size = fallback_type_size(info.name);
            if (info.alignment == 0) info.alignment = info.byte_size;
        }

        global_type_cache[offset] = info;
        return info;
    };

    for (const auto& [offset, _] : raw_types) {
        resolve_type(resolve_type, offset, 0);
    }

    // ---------------------------------------------------------------------------
    // STEP 4: Build StructLayouts and StructMembers with fully resolved types
    // ---------------------------------------------------------------------------
    for (auto& cu : cus) {
        struct DIEFrame {
            uint16_t tag;
            uint64_t die_offset;
            bool has_children;
            std::optional<StructLayout> layout;
            std::optional<StructMember> member;
        };

        std::vector<DIEFrame> die_stack;
        std::string current_cu_name = cu.cu_name;

        for (const auto& die : cu.dies) {
            if (die.tag == 0) {
                if (!die_stack.empty()) {
                    auto top = std::move(die_stack.back());
                    die_stack.pop_back();

                    if (top.layout.has_value()) {
                        StructLayout& sl = *top.layout;
                        if (!sl.name.empty() && sl.byte_size > 0) {
                            result.push_back(std::move(sl));
                        }
                    } else if (top.member.has_value() && !die_stack.empty() && die_stack.back().layout.has_value()) {
                        die_stack.back().layout->members.push_back(std::move(*top.member));
                    }
                }
                continue;
            }

            DIEFrame frame;
            frame.tag = die.tag;
            frame.die_offset = die.offset;
            frame.has_children = die.has_children;

            std::string attr_name;
            uint64_t attr_byte_size = 0;
            uint64_t attr_alignment = 0;
            bool attr_is_declaration = false;
            uint64_t attr_type_ref = UINT64_MAX;
            std::optional<uint64_t> attr_data_member_location;
            uint32_t attr_decl_line = 0;
            uint32_t attr_bit_offset = 0;
            uint32_t attr_bit_size = 0;
            bool attr_is_bitfield = false;

            for (const auto& [attr, v] : die.attrs) {
                switch (attr) {
                    case dwarf::DW_AT_name:
                        if (v.kind == AttrValue::Kind::String) attr_name = v.sval;
                        break;
                    case dwarf::DW_AT_byte_size:
                        attr_byte_size = (v.kind == AttrValue::Kind::Uint) ? v.uval : static_cast<uint64_t>(v.ival);
                        break;
                    case dwarf::DW_AT_alignment:
                        if (v.kind == AttrValue::Kind::Uint) attr_alignment = v.uval;
                        break;
                    case dwarf::DW_AT_declaration:
                        if (v.kind == AttrValue::Kind::Uint) attr_is_declaration = (v.uval != 0);
                        break;
                    case dwarf::DW_AT_type:
                        if (v.kind == AttrValue::Kind::Ref) {
                            attr_type_ref = cu.cu_start + v.uval;
                        } else if (v.kind == AttrValue::Kind::Uint) {
                            attr_type_ref = v.uval;
                        }
                        break;
                    case dwarf::DW_AT_data_member_location:
                        attr_data_member_location = decode_location(v);
                        break;
                    case dwarf::DW_AT_decl_line:
                        if (v.kind == AttrValue::Kind::Uint) attr_decl_line = static_cast<uint32_t>(v.uval);
                        break;
                    case dwarf::DW_AT_bit_size:
                        if (v.kind == AttrValue::Kind::Uint) {
                            attr_bit_size = static_cast<uint32_t>(v.uval);
                            attr_is_bitfield = true;
                        }
                        break;
                    case dwarf::DW_AT_bit_offset:
                        if (v.kind == AttrValue::Kind::Uint) attr_bit_offset = static_cast<uint32_t>(v.uval);
                        break;
                    default:
                        break;
                }
            }

            if (die.tag == dwarf::DW_TAG_compile_unit) {
                current_cu_name = attr_name;
            }

            // Struct / Class DIE
            if ((die.tag == dwarf::DW_TAG_structure_type || die.tag == dwarf::DW_TAG_class_type) &&
                !attr_is_declaration && attr_byte_size > 0) {
                StructLayout sl;
                sl.name = attr_name.empty() ? "<anonymous>" : attr_name;
                sl.tag = (die.tag == dwarf::DW_TAG_class_type) ? "class" : "struct";
                sl.byte_size = attr_byte_size;
                sl.alignment = attr_alignment ? attr_alignment : (attr_byte_size >= 8 ? 8 : (attr_byte_size >= 4 ? 4 : 1));
                sl.source_line = attr_decl_line;
                sl.source_file = current_cu_name;
                frame.layout = std::move(sl);
            }

            // Member / Inheritance DIE
            if ((die.tag == dwarf::DW_TAG_member || die.tag == dwarf::DW_TAG_inheritance) &&
                !die_stack.empty() && die_stack.back().layout.has_value()) {
                StructMember m;
                m.name = attr_name.empty() ? (die.tag == dwarf::DW_TAG_inheritance ? "<base>" : "<anon>") : attr_name;
                m.is_base_class = (die.tag == dwarf::DW_TAG_inheritance);
                m.offset = attr_data_member_location.value_or(0);
                m.is_bitfield = attr_is_bitfield;
                m.bit_offset = attr_bit_offset;
                m.bit_size = attr_bit_size;

                if (attr_type_ref != UINT64_MAX) {
                    auto tit = global_type_cache.find(attr_type_ref);
                    if (tit != global_type_cache.end()) {
                        m.type_name = tit->second.name;
                        m.byte_size = tit->second.byte_size;
                        m.alignment = tit->second.alignment;
                    } else {
                        m.type_name = "unknown";
                    }
                }
                if (attr_byte_size > 0) m.byte_size = attr_byte_size;
                if (attr_alignment > 0) m.alignment = attr_alignment;
                if (m.byte_size == 0) m.byte_size = fallback_type_size(m.type_name);
                if (m.alignment == 0) m.alignment = m.byte_size > 0 ? m.byte_size : 1;

                if (!die.has_children) {
                    die_stack.back().layout->members.push_back(std::move(m));
                    continue;
                } else {
                    frame.member = std::move(m);
                }
            }

            if (die.has_children) {
                die_stack.push_back(std::move(frame));
            }
        }
    }

    // Sort members by offset within each struct and infer any missing sizes
    for (auto& sl : result) {
        std::stable_sort(sl.members.begin(), sl.members.end(),
            [](const StructMember& a, const StructMember& b) {
                return a.offset < b.offset;
            });

        // Infer missing member sizes if any member still has size 0
        for (size_t i = 0; i < sl.members.size(); ++i) {
            if (sl.members[i].byte_size == 0) {
                if (i + 1 < sl.members.size() && sl.members[i + 1].offset > sl.members[i].offset) {
                    sl.members[i].byte_size = sl.members[i + 1].offset - sl.members[i].offset;
                } else if (sl.byte_size > sl.members[i].offset) {
                    sl.members[i].byte_size = sl.byte_size - sl.members[i].offset;
                }
            }
        }
    }

    return result;
}

} // namespace dwarflens
