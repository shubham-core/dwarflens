// SPDX-License-Identifier: MIT
// DwarfLens — diff_engine.cpp
#include "dwarflens/diff_engine.hpp"
#include <algorithm>
#include <cmath>
#include <unordered_map>

namespace dwarflens {

DiffResult DiffEngine::diff(const BinaryAnalysis& base,
                             const BinaryAnalysis& target) {
    DiffResult result;
    result.base_filename   = base.filename;
    result.target_filename = target.filename;

    // -------------------------------------------------------------------------
    // Top-level size deltas
    // -------------------------------------------------------------------------
    result.file_size_delta = static_cast<int64_t>(target.file_size) -
                             static_cast<int64_t>(base.file_size);
    result.flash_delta     = static_cast<int64_t>(target.flash_size) -
                             static_cast<int64_t>(base.flash_size);
    result.ram_delta       = static_cast<int64_t>(target.ram_size) -
                             static_cast<int64_t>(base.ram_size);

    auto pct = [](int64_t delta, uint64_t base_val) -> double {
        if (base_val == 0) return delta != 0 ? 100.0 : 0.0;
        return 100.0 * static_cast<double>(delta) /
               static_cast<double>(base_val);
    };

    result.file_size_pct = pct(result.file_size_delta, base.file_size);
    result.flash_pct     = pct(result.flash_delta, base.flash_size);
    result.ram_pct       = pct(result.ram_delta, base.ram_size);

    // -------------------------------------------------------------------------
    // Section deltas
    // -------------------------------------------------------------------------
    std::unordered_map<std::string, uint64_t> base_sections, target_sections;
    for (const auto& s : base.sections)    base_sections[s.name]   = s.size;
    for (const auto& s : target.sections)  target_sections[s.name] = s.size;

    // Process all section names from both binaries
    std::vector<std::string> all_section_names;
    for (const auto& [name, _] : base_sections)   all_section_names.push_back(name);
    for (const auto& [name, _] : target_sections) {
        if (!base_sections.count(name)) all_section_names.push_back(name);
    }

    for (const auto& name : all_section_names) {
        bool in_base   = base_sections.count(name) > 0;
        bool in_target = target_sections.count(name) > 0;
        uint64_t bs = in_base   ? base_sections[name]   : 0;
        uint64_t ts = in_target ? target_sections[name] : 0;

        DiffResult::SectionDelta sd;
        sd.name        = name;
        sd.base_size   = bs;
        sd.target_size = ts;
        sd.delta_bytes = static_cast<int64_t>(ts) - static_cast<int64_t>(bs);
        sd.delta_pct   = pct(sd.delta_bytes, bs);

        if (!in_base)                     sd.change = DiffResult::SectionDelta::Change::Added;
        else if (!in_target)              sd.change = DiffResult::SectionDelta::Change::Removed;
        else if (sd.delta_bytes != 0)     sd.change = DiffResult::SectionDelta::Change::Modified;
        else                              sd.change = DiffResult::SectionDelta::Change::Unchanged;

        result.section_deltas.push_back(std::move(sd));
    }

    // Sort sections: removed/added first, then by abs delta size
    std::sort(result.section_deltas.begin(), result.section_deltas.end(),
        [](const DiffResult::SectionDelta& a, const DiffResult::SectionDelta& b) {
            return std::abs(a.delta_bytes) > std::abs(b.delta_bytes);
        });

    // -------------------------------------------------------------------------
    // Symbol deltas (top 200 by absolute change)
    // -------------------------------------------------------------------------
    std::unordered_map<std::string, const BinaryAnalysis::SymbolSummary*> base_syms, target_syms;
    for (const auto& s : base.symbols)   base_syms[s.name]   = &s;
    for (const auto& s : target.symbols) target_syms[s.name] = &s;

    std::vector<std::string> all_sym_names;
    for (const auto& [name, _] : base_syms)   all_sym_names.push_back(name);
    for (const auto& [name, _] : target_syms) {
        if (!base_syms.count(name)) all_sym_names.push_back(name);
    }

    for (const auto& name : all_sym_names) {
        bool in_base   = base_syms.count(name) > 0;
        bool in_target = target_syms.count(name) > 0;
        uint64_t bs = in_base   ? base_syms[name]->size   : 0;
        uint64_t ts = in_target ? target_syms[name]->size : 0;

        if (bs == ts) continue; // no change

        DiffResult::SymbolDelta sd;
        sd.name        = name;
        sd.base_size   = bs;
        sd.target_size = ts;
        sd.delta_bytes = static_cast<int64_t>(ts) - static_cast<int64_t>(bs);
        sd.section     = in_target ? target_syms[name]->section : base_syms[name]->section;
        sd.template_group = in_target ? target_syms[name]->template_group
                                       : base_syms[name]->template_group;

        if (!in_base)               sd.change = DiffResult::SymbolDelta::Change::Added;
        else if (!in_target)        sd.change = DiffResult::SymbolDelta::Change::Removed;
        else if (sd.delta_bytes > 0) sd.change = DiffResult::SymbolDelta::Change::Grew;
        else                        sd.change = DiffResult::SymbolDelta::Change::Shrank;

        result.symbol_deltas.push_back(std::move(sd));
    }

    std::sort(result.symbol_deltas.begin(), result.symbol_deltas.end(),
        [](const DiffResult::SymbolDelta& a, const DiffResult::SymbolDelta& b) {
            return std::abs(a.delta_bytes) > std::abs(b.delta_bytes);
        });

    // Cap at 200 symbols
    if (result.symbol_deltas.size() > 200)
        result.symbol_deltas.resize(200);

    // -------------------------------------------------------------------------
    // Struct layout regressions
    // -------------------------------------------------------------------------
    std::unordered_map<std::string, const StructLayout*> base_structs, target_structs;
    for (const auto& s : base.structs)   base_structs[s.name]   = &s;
    for (const auto& s : target.structs) target_structs[s.name] = &s;

    for (const auto& [name, ts] : target_structs) {
        auto it = base_structs.find(name);
        if (it == base_structs.end()) continue;
        const StructLayout* bs = it->second;

        DiffResult::StructRegression reg;
        reg.name           = name;
        reg.size_delta     = static_cast<int64_t>(ts->byte_size) -
                             static_cast<int64_t>(bs->byte_size);
        reg.padding_delta  = static_cast<int64_t>(ts->total_padding_bytes) -
                             static_cast<int64_t>(bs->total_padding_bytes);
        reg.cache_line_delta = static_cast<int64_t>(ts->cache_lines_spanned) -
                               static_cast<int64_t>(bs->cache_lines_spanned);
        reg.is_regression  = (reg.size_delta > 0 || reg.padding_delta > 0 ||
                               reg.cache_line_delta > 0);

        if (reg.size_delta != 0 || reg.padding_delta != 0 || reg.cache_line_delta != 0)
            result.struct_regressions.push_back(std::move(reg));
    }

    std::sort(result.struct_regressions.begin(), result.struct_regressions.end(),
        [](const DiffResult::StructRegression& a, const DiffResult::StructRegression& b) {
            return a.size_delta > b.size_delta;
        });

    return result;
}

void DiffEngine::apply_thresholds(DiffResult& result,
                                   int64_t max_growth_bytes,
                                   bool fail_on_padding_regression) {
    result.growth_threshold_bytes = max_growth_bytes;
    if (max_growth_bytes >= 0 && result.file_size_delta > max_growth_bytes)
        result.exceeded_growth_threshold = true;

    if (fail_on_padding_regression) {
        for (const auto& reg : result.struct_regressions) {
            if (reg.is_regression && reg.padding_delta > 0) {
                result.has_padding_regression = true;
                break;
            }
        }
    }
}

} // namespace dwarflens
