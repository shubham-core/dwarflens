// SPDX-License-Identifier: MIT
// DwarfLens — struct_layout.cpp
// Memory layout analysis: padding hole detection, cache-line crossings,
// and optimal member reordering with C++ and Rust code snippet generation.

#include "dwarflens/struct_layout.hpp"

#include <algorithm>
#include <cstdint>
#include <sstream>
#include <string>
#include <string_view>
#include <unordered_set>
#include <utility>
#include <vector>

namespace dwarflens {

namespace {

// Thread-local context to pass original and optimal sizes to generate_cpp_snippet
// without altering the method signature declared in the public header.
thread_local uint64_t tl_was_size = 0;
thread_local uint64_t tl_now_size = 0;

[[nodiscard]] constexpr uint64_t align_up(uint64_t offset, uint64_t align) noexcept {
    if (align <= 1) return offset;
    uint64_t rem = offset % align;
    if (rem == 0) return offset;
    return offset + (align - rem);
}

[[nodiscard]] uint64_t effective_alignment(const StructMember& m) noexcept {
    if (m.alignment > 0) return m.alignment;
    if (m.byte_size >= 8) return 8;
    if (m.byte_size >= 4) return 4;
    if (m.byte_size >= 2) return 2;
    return 1;
}

[[nodiscard]] bool is_rust_keyword(std::string_view s) noexcept {
    static const std::unordered_set<std::string_view> kw = {
        "as", "break", "const", "continue", "crate", "else", "enum", "extern",
        "false", "fn", "for", "if", "impl", "in", "let", "loop", "match", "mod",
        "move", "mut", "pub", "ref", "return", "self", "Self", "static", "struct",
        "super", "trait", "true", "type", "unsafe", "use", "where", "while",
        "async", "await", "dyn", "abstract", "become", "box", "do", "final",
        "macro", "override", "priv", "typeof", "unsized", "virtual", "yield", "try"
    };
    return kw.contains(s);
}

[[nodiscard]] std::string sanitize_rust_ident(const std::string& name, uint64_t offset) {
    if (name.empty() || name == "<anon>" || name.front() == '<') {
        return "_anon_" + std::to_string(offset);
    }
    if (is_rust_keyword(name)) {
        return "r#" + name;
    }
    return name;
}

[[nodiscard]] std::string to_rust_type(const std::string& cpp_type, uint64_t byte_size) {
    // Check for array syntax, e.g. "uint8_t[60]" or "int [4]"
    auto bracket_pos = cpp_type.find('[');
    if (bracket_pos != std::string::npos) {
        auto bracket_end = cpp_type.find(']', bracket_pos);
        if (bracket_end != std::string::npos) {
            std::string elem_type = cpp_type.substr(0, bracket_pos);
            while (!elem_type.empty() && elem_type.back() == ' ') elem_type.pop_back();
            std::string count = cpp_type.substr(bracket_pos + 1, bracket_end - bracket_pos - 1);
            while (!count.empty() && count.front() == ' ') count.erase(count.begin());
            while (!count.empty() && count.back() == ' ') count.pop_back();
            std::string rust_elem = to_rust_type(elem_type, 0);
            return "[" + rust_elem + "; " + count + "]";
        }
    }

    // Pointer types
    if (!cpp_type.empty() && cpp_type.back() == '*') {
        std::string pointee = cpp_type.substr(0, cpp_type.size() - 1);
        while (!pointee.empty() && pointee.back() == ' ') pointee.pop_back();
        if (pointee == "void" || pointee == "const void") {
            return "*mut std::ffi::c_void";
        }
        std::string rust_pointee = to_rust_type(pointee, 0);
        return "*mut " + rust_pointee;
    }

    // Fundamental and stdint types
    if (cpp_type == "bool" || cpp_type == "_Bool") return "bool";
    if (cpp_type == "char" || cpp_type == "signed char" || cpp_type == "int8_t") return "i8";
    if (cpp_type == "unsigned char" || cpp_type == "uint8_t" || cpp_type == "byte") return "u8";
    if (cpp_type == "short" || cpp_type == "short int" || cpp_type == "int16_t" || cpp_type == "signed short") return "i16";
    if (cpp_type == "unsigned short" || cpp_type == "uint16_t" || cpp_type == "unsigned short int") return "u16";
    if (cpp_type == "int" || cpp_type == "int32_t" || cpp_type == "signed int" || cpp_type == "signed") return "i32";
    if (cpp_type == "unsigned int" || cpp_type == "uint32_t" || cpp_type == "unsigned") return "u32";
    if (cpp_type == "long long" || cpp_type == "long long int" || cpp_type == "int64_t" || cpp_type == "signed long long") return "i64";
    if (cpp_type == "unsigned long long" || cpp_type == "uint64_t" || cpp_type == "unsigned long long int") return "u64";
    if (cpp_type == "long" || cpp_type == "long int") return byte_size == 4 ? "i32" : "i64";
    if (cpp_type == "unsigned long" || cpp_type == "unsigned long int") return byte_size == 4 ? "u32" : "u64";
    if (cpp_type == "float") return "f32";
    if (cpp_type == "double") return "f64";
    if (cpp_type == "size_t" || cpp_type == "uintptr_t") return "usize";
    if (cpp_type == "ssize_t" || cpp_type == "ptrdiff_t" || cpp_type == "intptr_t") return "isize";

    if (cpp_type.empty() || cpp_type == "unknown") {
        if (byte_size == 1) return "u8";
        if (byte_size == 2) return "u16";
        if (byte_size == 4) return "u32";
        if (byte_size == 8) return "u64";
        if (byte_size > 0) return "[u8; " + std::to_string(byte_size) + "]";
        return "u8";
    }

    return cpp_type;
}

[[nodiscard]] std::string format_cpp_member_decl(const StructMember& m) {
    std::string type = m.type_name;
    if (type.empty() || type == "unknown") {
        if (m.byte_size == 1) type = "uint8_t";
        else if (m.byte_size == 2) type = "uint16_t";
        else if (m.byte_size == 4) type = "uint32_t";
        else if (m.byte_size == 8) type = "uint64_t";
        else type = "uint8_t";
    }
    std::string name = m.name;
    if (name.empty() || name == "<anon>" || name.front() == '<') {
        name = "_anon_" + std::to_string(m.offset);
    }

    // Array syntax in type: e.g. "uint8_t[60]" -> "uint8_t header[60]"
    auto bracket_pos = type.find('[');
    if (bracket_pos != std::string::npos) {
        std::string elem_type = type.substr(0, bracket_pos);
        while (!elem_type.empty() && elem_type.back() == ' ') elem_type.pop_back();
        std::string array_suffix = type.substr(bracket_pos);
        return elem_type + " " + name + array_suffix;
    }

    if ((m.type_name.empty() || m.type_name == "unknown") && m.byte_size > 8) {
        return "uint8_t " + name + "[" + std::to_string(m.byte_size) + "]";
    }

    return type + " " + name;
}

} // anonymous namespace

// ---------------------------------------------------------------------------
// LayoutAnalyzer::analyze
// ---------------------------------------------------------------------------
void LayoutAnalyzer::analyze(StructLayout& layout) {
    compute_padding(layout);
    compute_cache_lines(layout);
    compute_optimal(layout);
}

// ---------------------------------------------------------------------------
// LayoutAnalyzer::compute_padding
// ---------------------------------------------------------------------------
void LayoutAnalyzer::compute_padding(StructLayout& layout) {
    layout.padding_holes.clear();
    layout.total_padding_bytes = 0;

    if (layout.members.empty()) {
        layout.useful_bytes = layout.byte_size;
        return;
    }

    // Sort members by offset (preserving order for bitfields at identical offset)
    std::stable_sort(layout.members.begin(), layout.members.end(),
        [](const StructMember& a, const StructMember& b) {
            return a.offset < b.offset;
        });

    // Check for leading padding before the first member
    if (layout.members.front().offset > 0) {
        uint64_t gap_bytes = layout.members.front().offset;
        layout.padding_holes.push_back(PaddingHole{
            .offset = 0,
            .size = gap_bytes,
            .before = "[start]",
            .after = layout.members.front().name
        });
    }

    // Walk consecutive pairs
    uint64_t current_end = layout.members.front().offset + layout.members.front().byte_size;
    for (size_t i = 0; i + 1 < layout.members.size(); ++i) {
        uint64_t member_end = layout.members[i].offset + layout.members[i].byte_size;
        current_end = std::max(current_end, member_end);

        if (current_end < layout.members[i + 1].offset) {
            uint64_t gap_bytes = layout.members[i + 1].offset - current_end;
            layout.padding_holes.push_back(PaddingHole{
                .offset = current_end,
                .size = gap_bytes,
                .before = layout.members[i].name,
                .after = layout.members[i + 1].name
            });
            current_end = layout.members[i + 1].offset;
        }
    }

    // Check for tail padding
    const auto& last_member = layout.members.back();
    uint64_t last_end = std::max(current_end, last_member.offset + last_member.byte_size);
    if (last_end < layout.byte_size) {
        uint64_t gap_bytes = layout.byte_size - last_end;
        layout.padding_holes.push_back(PaddingHole{
            .offset = last_end,
            .size = gap_bytes,
            .before = last_member.name,
            .after = "[tail]"
        });
    }

    // Sum all hole sizes into total_padding_bytes
    for (const auto& hole : layout.padding_holes) {
        layout.total_padding_bytes += hole.size;
    }

    // useful_bytes = byte_size - total_padding_bytes
    if (layout.byte_size >= layout.total_padding_bytes) {
        layout.useful_bytes = layout.byte_size - layout.total_padding_bytes;
    } else {
        layout.useful_bytes = 0;
    }
}

// ---------------------------------------------------------------------------
// LayoutAnalyzer::compute_cache_lines
// ---------------------------------------------------------------------------
void LayoutAnalyzer::compute_cache_lines(StructLayout& layout) {
    layout.cache_line_crossings.clear();

    if (layout.byte_size == 0) {
        layout.cache_lines_spanned = 0;
    } else {
        layout.cache_lines_spanned = static_cast<uint32_t>(
            std::max<uint64_t>(1, (layout.byte_size + kCacheLineSize - 1) / kCacheLineSize));
    }

    for (const auto& member : layout.members) {
        if (member.byte_size == 0) continue;

        uint64_t start_line = member.offset / kCacheLineSize;
        uint64_t end_line = (member.offset + member.byte_size - 1) / kCacheLineSize;

        if (start_line != end_line) {
            layout.cache_line_crossings.push_back(CacheLineCrossing{
                .member_name = member.name,
                .member_offset = member.offset,
                .member_size = member.byte_size,
                .boundary = (start_line + 1) * kCacheLineSize
            });
        }
    }
}

// ---------------------------------------------------------------------------
// LayoutAnalyzer::compute_optimal
// ---------------------------------------------------------------------------
void LayoutAnalyzer::compute_optimal(StructLayout& layout) {
    layout.optimal.reset();

    if (layout.byte_size == 0) return;

    // Skip if layout has no non-bitfield, non-base-class members to reorder
    bool has_bitfield = false;
    size_t reorder_count = 0;
    for (const auto& m : layout.members) {
        if (m.is_bitfield) {
            has_bitfield = true;
        } else if (!m.is_base_class) {
            reorder_count++;
        }
    }

    if (has_bitfield || reorder_count == 0) {
        return;
    }

    // Separate base class members (keep at front, fixed order) from non-base-class members
    std::vector<StructMember> base_members;
    std::vector<StructMember> reorder_members;
    base_members.reserve(layout.members.size());
    reorder_members.reserve(layout.members.size());

    for (const auto& m : layout.members) {
        if (m.is_base_class) {
            base_members.push_back(m);
        } else {
            reorder_members.push_back(m);
        }
    }

    // Sort non-base-class members by descending alignment, then descending size, then name
    std::stable_sort(reorder_members.begin(), reorder_members.end(),
        [](const StructMember& a, const StructMember& b) {
            uint64_t align_a = effective_alignment(a);
            uint64_t align_b = effective_alignment(b);
            if (align_a != align_b) {
                return align_a > align_b; // descending alignment
            }
            if (a.byte_size != b.byte_size) {
                return a.byte_size > b.byte_size; // descending size
            }
            return a.name < b.name; // ascending name (deterministic)
        });

    // Simulate packing: start after base class space
    uint64_t cursor = 0;
    for (const auto& bm : base_members) {
        cursor = std::max(cursor, bm.offset + bm.byte_size);
    }

    std::vector<StructMember> optimal_members;
    optimal_members.reserve(layout.members.size());

    for (const auto& bm : base_members) {
        optimal_members.push_back(bm);
    }

    for (auto m : reorder_members) {
        uint64_t align = effective_alignment(m);
        cursor = align_up(cursor, align);
        m.offset = cursor;
        cursor += m.byte_size;
        optimal_members.push_back(std::move(m));
    }

    // Round up final cursor to struct alignment
    uint64_t struct_align = layout.alignment;
    if (struct_align == 0) {
        for (const auto& m : layout.members) {
            struct_align = std::max(struct_align, effective_alignment(m));
        }
        if (struct_align == 0) struct_align = 1;
    }

    uint64_t optimal_byte_size = align_up(cursor, struct_align);

    // Compute optimal_byte_size and bytes_saved = layout.byte_size - optimal_byte_size
    // Only store OptimalLayout if bytes_saved > 0
    if (layout.byte_size <= optimal_byte_size) {
        return;
    }

    uint64_t bytes_saved = layout.byte_size - optimal_byte_size;

    // Generate snippets with original vs optimal metrics
    tl_was_size = layout.byte_size;
    tl_now_size = optimal_byte_size;

    std::string cpp_snippet = generate_cpp_snippet(layout.name, layout.tag, optimal_members);
    std::string rust_snippet = generate_rust_snippet(layout.name, optimal_members);

    tl_was_size = 0;
    tl_now_size = 0;

    StructLayout::OptimalLayout optimal;
    optimal.members = std::move(optimal_members);
    optimal.byte_size = optimal_byte_size;
    optimal.bytes_saved = bytes_saved;
    optimal.cpp_snippet = std::move(cpp_snippet);
    optimal.rust_snippet = std::move(rust_snippet);

    layout.optimal = std::move(optimal);
}

// ---------------------------------------------------------------------------
// LayoutAnalyzer::generate_cpp_snippet
// ---------------------------------------------------------------------------
std::string LayoutAnalyzer::generate_cpp_snippet(
    const std::string& name,
    const std::string& tag,
    const std::vector<StructMember>& members) {

    uint64_t was_size = tl_was_size;
    uint64_t now_size = tl_now_size;

    std::ostringstream oss;

    if (was_size > 0 && now_size > 0 && was_size > now_size) {
        uint64_t saves = was_size - now_size;
        oss << "// was: " << was_size << " bytes, now: " << now_size
            << " bytes, saves " << saves << " bytes per instance\n";
    }

    std::string kw = (tag.empty() || tag == "struct") ? "struct" : tag;
    std::string struct_name = (name.empty() || name == "<anonymous>") ? "AnonymousStruct" : name;

    oss << kw << " " << struct_name << " {\n";

    for (const auto& m : members) {
        if (m.is_base_class) {
            oss << "  // base class: " << m.type_name
                << " (offset: " << m.offset << ", size: " << m.byte_size << ")\n";
        } else {
            oss << "  " << format_cpp_member_decl(m)
                << "; // offset: " << m.offset << ", size: " << m.byte_size << "\n";
        }
    }

    if (was_size > 0 && now_size > 0 && was_size > now_size) {
        uint64_t saves = was_size - now_size;
        oss << "  // Saves " << saves << " bytes (was " << was_size << " bytes)\n";
    }

    oss << "};";
    return oss.str();
}

// ---------------------------------------------------------------------------
// LayoutAnalyzer::generate_rust_snippet
// ---------------------------------------------------------------------------
std::string LayoutAnalyzer::generate_rust_snippet(
    const std::string& name,
    const std::vector<StructMember>& members) {

    std::string struct_name = name;
    // Strip namespaces for Rust struct name if present
    auto colons = struct_name.rfind("::");
    if (colons != std::string::npos) {
        struct_name = struct_name.substr(colons + 2);
    }
    // Strip template parameters if present
    auto angle = struct_name.find('<');
    if (angle != std::string::npos) {
        struct_name = struct_name.substr(0, angle);
    }
    if (struct_name.empty() || struct_name == "<anonymous>" || struct_name.front() == '<') {
        struct_name = "AnonymousStruct";
    }

    std::ostringstream oss;
    oss << "#[repr(C)]\n";
    oss << "struct " << struct_name << " {\n";

    for (const auto& m : members) {
        if (m.is_base_class) {
            oss << "  // base class: " << m.type_name << "\n";
            continue;
        }
        std::string rust_name = sanitize_rust_ident(m.name, m.offset);
        std::string rust_type = to_rust_type(m.type_name, m.byte_size);
        oss << "  " << rust_name << ": " << rust_type << ",\n";
    }

    oss << "}";
    return oss.str();
}

} // namespace dwarflens
