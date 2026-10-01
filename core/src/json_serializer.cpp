// SPDX-License-Identifier: MIT
// DwarfLens — json_serializer.cpp
#include "dwarflens/json_serializer.hpp"
#include <sstream>
#include <algorithm>

namespace dwarflens {

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
static std::string jb_quote(const std::string& s) {
    return JsonBuilder::quote(s);
}

static std::string serialize_section_summary(
    const BinaryAnalysis::SectionSummary& s, int ind) {
    std::string i(ind * 2, ' ');
    std::string i2((ind + 1) * 2, ' ');
    std::ostringstream o;
    o << i << "{\n";
    o << i2 << JsonBuilder::kv("name",     s.name)     << ",\n";
    o << i2 << JsonBuilder::kv("category", s.category) << ",\n";
    o << i2 << JsonBuilder::kv("size",     s.size)     << ",\n";
    o << i2 << JsonBuilder::kv("vm_addr",  s.vm_addr)  << "\n";
    o << i << "}";
    return o.str();
}

static std::string serialize_symbol_summary(
    const BinaryAnalysis::SymbolSummary& s, int ind) {
    std::string i(ind * 2, ' ');
    std::string i2((ind + 1) * 2, ' ');
    std::ostringstream o;
    o << i << "{\n";
    o << i2 << JsonBuilder::kv("name",           s.name)           << ",\n";
    o << i2 << JsonBuilder::kv("raw_name",        s.raw_name)       << ",\n";
    o << i2 << JsonBuilder::kv("section",         s.section)        << ",\n";
    o << i2 << JsonBuilder::kv("compile_unit",    s.compile_unit)   << ",\n";
    o << i2 << JsonBuilder::kv("template_group",  s.template_group) << ",\n";
    o << i2 << JsonBuilder::kv("size",            s.size)           << ",\n";
    o << i2 << JsonBuilder::kv("type",            s.type)           << "\n";
    o << i << "}";
    return o.str();
}

static std::string serialize_member(const StructMember& m, int ind) {
    std::string i(ind * 2, ' ');
    std::string i2((ind + 1) * 2, ' ');
    std::ostringstream o;
    o << i << "{\n";
    o << i2 << JsonBuilder::kv("name",        m.name)      << ",\n";
    o << i2 << JsonBuilder::kv("type_name",   m.type_name) << ",\n";
    o << i2 << JsonBuilder::kv("offset",      m.offset)    << ",\n";
    o << i2 << JsonBuilder::kv("byte_size",   m.byte_size) << ",\n";
    o << i2 << JsonBuilder::kv("alignment",   m.alignment) << ",\n";
    o << i2 << JsonBuilder::kv("is_bitfield", m.is_bitfield) << ",\n";
    o << i2 << JsonBuilder::kv("is_base_class", m.is_base_class) << "\n";
    o << i << "}";
    return o.str();
}

static std::string serialize_padding_hole(const PaddingHole& h, int ind) {
    std::string i(ind * 2, ' ');
    std::string i2((ind + 1) * 2, ' ');
    std::ostringstream o;
    o << i << "{\n";
    o << i2 << JsonBuilder::kv("offset", h.offset) << ",\n";
    o << i2 << JsonBuilder::kv("size",   h.size)   << ",\n";
    o << i2 << JsonBuilder::kv("before", h.before) << ",\n";
    o << i2 << JsonBuilder::kv("after",  h.after)  << "\n";
    o << i << "}";
    return o.str();
}

static std::string serialize_cache_line_crossing(const CacheLineCrossing& c, int ind) {
    std::string i(ind * 2, ' ');
    std::string i2((ind + 1) * 2, ' ');
    std::ostringstream o;
    o << i << "{\n";
    o << i2 << JsonBuilder::kv("member_name",   c.member_name)   << ",\n";
    o << i2 << JsonBuilder::kv("member_offset", c.member_offset) << ",\n";
    o << i2 << JsonBuilder::kv("member_size",   c.member_size)   << ",\n";
    o << i2 << JsonBuilder::kv("boundary",      c.boundary)      << "\n";
    o << i << "}";
    return o.str();
}

static std::string array_of(const std::vector<std::string>& items, int ind) {
    if (items.empty()) return "[]";
    std::ostringstream o;
    o << "[\n";
    for (size_t i = 0; i < items.size(); ++i) {
        o << items[i];
        if (i + 1 < items.size()) o << ",";
        o << "\n";
    }
    o << std::string(ind * 2, ' ') << "]";
    return o.str();
}

// ---------------------------------------------------------------------------
// StructLayout
// ---------------------------------------------------------------------------
std::string JsonSerializer::serialize(const StructLayout& layout) {
    std::ostringstream o;
    std::string i2("  "), i4("    ");
    o << "{\n";
    o << i2 << JsonBuilder::kv("name",                layout.name)                << ",\n";
    o << i2 << JsonBuilder::kv("tag",                 layout.tag)                 << ",\n";
    o << i2 << JsonBuilder::kv("source_file",         layout.source_file)         << ",\n";
    o << i2 << JsonBuilder::kv("source_line",   (uint64_t)layout.source_line)     << ",\n";
    o << i2 << JsonBuilder::kv("byte_size",           layout.byte_size)           << ",\n";
    o << i2 << JsonBuilder::kv("alignment",           layout.alignment)           << ",\n";
    o << i2 << JsonBuilder::kv("total_padding_bytes", layout.total_padding_bytes) << ",\n";
    o << i2 << JsonBuilder::kv("useful_bytes",        layout.useful_bytes)        << ",\n";
    o << i2 << JsonBuilder::kv("cache_lines_spanned",(uint64_t)layout.cache_lines_spanned) << ",\n";
    o << i2 << JsonBuilder::kv("has_padding",         layout.has_padding())       << ",\n";
    o << i2 << JsonBuilder::kv("has_cache_line_crossing", layout.has_cache_line_crossing()) << ",\n";

    // members
    {
        std::vector<std::string> items;
        for (const auto& m : layout.members) items.push_back(serialize_member(m, 3));
        o << i2 << "\"members\": " << array_of(items, 2) << ",\n";
    }
    // padding_holes
    {
        std::vector<std::string> items;
        for (const auto& h : layout.padding_holes) items.push_back(serialize_padding_hole(h, 3));
        o << i2 << "\"padding_holes\": " << array_of(items, 2) << ",\n";
    }
    // cache_line_crossings
    {
        std::vector<std::string> items;
        for (const auto& c : layout.cache_line_crossings)
            items.push_back(serialize_cache_line_crossing(c, 3));
        o << i2 << "\"cache_line_crossings\": " << array_of(items, 2) << ",\n";
    }
    // optimal
    if (layout.optimal.has_value()) {
        const auto& opt = *layout.optimal;
        o << i2 << "\"optimal\": {\n";
        o << i4 << JsonBuilder::kv("byte_size",   opt.byte_size)   << ",\n";
        o << i4 << JsonBuilder::kv("bytes_saved", opt.bytes_saved) << ",\n";
        o << i4 << JsonBuilder::kv("cpp_snippet", opt.cpp_snippet) << ",\n";
        o << i4 << JsonBuilder::kv("rust_snippet",opt.rust_snippet) << "\n";
        o << i2 << "}\n";
    } else {
        o << i2 << "\"optimal\": null\n";
    }
    o << "}";
    return o.str();
}

std::string JsonSerializer::serialize(const std::vector<StructLayout>& layouts) {
    std::vector<std::string> items;
    items.reserve(layouts.size());
    for (const auto& l : layouts) items.push_back(serialize(l));
    return array_of(items, 0);
}

// ---------------------------------------------------------------------------
// BinaryAnalysis
// ---------------------------------------------------------------------------
std::string JsonSerializer::serialize(const BinaryAnalysis& analysis) {
    std::ostringstream o;
    std::string i2("  ");
    o << "{\n";
    o << i2 << JsonBuilder::kv("filename",    analysis.filename)    << ",\n";
    o << i2 << JsonBuilder::kv("file_size",   analysis.file_size)   << ",\n";
    o << i2 << JsonBuilder::kv("format",      analysis.format == BinaryAnalysis::Format::ELF
                                               ? std::string("ELF") : std::string("Wasm")) << ",\n";
    o << i2 << JsonBuilder::kv("flash_size",  analysis.flash_size)  << ",\n";
    o << i2 << JsonBuilder::kv("ram_size",    analysis.ram_size)    << ",\n";

    {
        std::vector<std::string> items;
        for (const auto& s : analysis.sections) items.push_back(serialize_section_summary(s, 2));
        o << i2 << "\"sections\": " << array_of(items, 1) << ",\n";
    }
    {
        // Top 100 symbols by size
        std::vector<const BinaryAnalysis::SymbolSummary*> top;
        for (const auto& s : analysis.symbols) top.push_back(&s);
        std::sort(top.begin(), top.end(),
            [](const auto* a, const auto* b){ return a->size > b->size; });
        if (top.size() > 100) top.resize(100);
        std::vector<std::string> items;
        for (const auto* s : top) items.push_back(serialize_symbol_summary(*s, 2));
        o << i2 << "\"symbols\": " << array_of(items, 1) << ",\n";
    }
    {
        std::vector<std::string> items;
        for (const auto& l : analysis.structs) items.push_back(serialize(l));
        o << i2 << "\"structs\": " << array_of(items, 1) << "\n";
    }
    o << "}";
    return o.str();
}

// ---------------------------------------------------------------------------
// DiffResult
// ---------------------------------------------------------------------------
std::string JsonSerializer::serialize(const DiffResult& diff) {
    std::ostringstream o;
    std::string i2("  "), i4("    ");

    auto change_str = [](DiffResult::SectionDelta::Change c) {
        switch(c) {
            case DiffResult::SectionDelta::Change::Added:    return "added";
            case DiffResult::SectionDelta::Change::Removed:  return "removed";
            case DiffResult::SectionDelta::Change::Modified: return "modified";
            default: return "unchanged";
        }
    };
    auto sym_change_str = [](DiffResult::SymbolDelta::Change c) {
        switch(c) {
            case DiffResult::SymbolDelta::Change::Added:   return "added";
            case DiffResult::SymbolDelta::Change::Removed: return "removed";
            case DiffResult::SymbolDelta::Change::Grew:    return "grew";
            default: return "shrank";
        }
    };

    o << "{\n";
    o << i2 << JsonBuilder::kv("base_filename",   diff.base_filename)   << ",\n";
    o << i2 << JsonBuilder::kv("target_filename", diff.target_filename) << ",\n";
    o << i2 << JsonBuilder::kv("file_size_delta", diff.file_size_delta) << ",\n";
    o << i2 << JsonBuilder::kv("flash_delta",     diff.flash_delta)     << ",\n";
    o << i2 << JsonBuilder::kv("ram_delta",       diff.ram_delta)       << ",\n";
    o << i2 << JsonBuilder::kv("file_size_pct",   diff.file_size_pct)   << ",\n";
    o << i2 << JsonBuilder::kv("flash_pct",       diff.flash_pct)       << ",\n";
    o << i2 << JsonBuilder::kv("ram_pct",         diff.ram_pct)         << ",\n";
    o << i2 << JsonBuilder::kv("exceeded_growth_threshold", diff.exceeded_growth_threshold) << ",\n";
    o << i2 << JsonBuilder::kv("has_padding_regression",    diff.has_padding_regression)    << ",\n";

    // Section deltas
    {
        std::vector<std::string> items;
        for (const auto& sd : diff.section_deltas) {
            std::ostringstream so;
            so << i4 << "{\n";
            std::string i6("      ");
            so << i6 << JsonBuilder::kv("name",        sd.name)        << ",\n";
            so << i6 << JsonBuilder::kv("base_size",   sd.base_size)   << ",\n";
            so << i6 << JsonBuilder::kv("target_size", sd.target_size) << ",\n";
            so << i6 << JsonBuilder::kv("delta_bytes", sd.delta_bytes) << ",\n";
            so << i6 << JsonBuilder::kv("delta_pct",   sd.delta_pct)   << ",\n";
            so << i6 << JsonBuilder::kv("change",   std::string(change_str(sd.change))) << "\n";
            so << i4 << "}";
            items.push_back(so.str());
        }
        o << i2 << "\"section_deltas\": " << array_of(items, 1) << ",\n";
    }
    // Symbol deltas
    {
        std::vector<std::string> items;
        for (const auto& sd : diff.symbol_deltas) {
            std::ostringstream so;
            so << i4 << "{\n";
            std::string i6("      ");
            so << i6 << JsonBuilder::kv("name",           sd.name)           << ",\n";
            so << i6 << JsonBuilder::kv("section",        sd.section)        << ",\n";
            so << i6 << JsonBuilder::kv("template_group", sd.template_group) << ",\n";
            so << i6 << JsonBuilder::kv("base_size",      sd.base_size)      << ",\n";
            so << i6 << JsonBuilder::kv("target_size",    sd.target_size)    << ",\n";
            so << i6 << JsonBuilder::kv("delta_bytes",    sd.delta_bytes)    << ",\n";
            so << i6 << JsonBuilder::kv("change", std::string(sym_change_str(sd.change))) << "\n";
            so << i4 << "}";
            items.push_back(so.str());
        }
        o << i2 << "\"symbol_deltas\": " << array_of(items, 1) << ",\n";
    }
    // Struct regressions
    {
        std::vector<std::string> items;
        for (const auto& reg : diff.struct_regressions) {
            std::ostringstream so;
            so << i4 << "{\n";
            std::string i6("      ");
            so << i6 << JsonBuilder::kv("name",             reg.name)             << ",\n";
            so << i6 << JsonBuilder::kv("size_delta",       reg.size_delta)       << ",\n";
            so << i6 << JsonBuilder::kv("padding_delta",    reg.padding_delta)    << ",\n";
            so << i6 << JsonBuilder::kv("cache_line_delta", reg.cache_line_delta) << ",\n";
            so << i6 << JsonBuilder::kv("is_regression",    reg.is_regression)    << "\n";
            so << i4 << "}";
            items.push_back(so.str());
        }
        o << i2 << "\"struct_regressions\": " << array_of(items, 1) << "\n";
    }
    o << "}";
    return o.str();
}

} // namespace dwarflens
