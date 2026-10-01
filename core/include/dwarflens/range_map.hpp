// SPDX-License-Identifier: MIT
// DwarfLens — range_map.hpp
// Interval attribution tree that maps [start, end) ranges to hierarchical labels.
// Inspired by google/bloaty's FileMap concept.
#pragma once
#include <algorithm>
#include <cassert>
#include <cstdint>
#include <functional>
#include <optional>
#include <string>
#include <vector>

namespace dwarflens {

// ---------------------------------------------------------------------------
// Attribution level
// ---------------------------------------------------------------------------
enum class AttributionLevel : uint8_t {
    Section    = 0,  // coarsest: ELF section, Wasm section
    CompileUnit = 1, // intermediate: DWARF compile unit / Wasm module
    Symbol     = 2,  // finest: function/variable symbol
};

// ---------------------------------------------------------------------------
// RangeEntry — one attributed interval
// ---------------------------------------------------------------------------
struct RangeEntry {
    uint64_t start;     // inclusive (file offset OR vm address)
    uint64_t end;       // exclusive
    std::string label;  // human-readable name
    AttributionLevel level{AttributionLevel::Section};
    std::string section_name; // parent section (if level > Section)
    std::string compile_unit; // parent CU (if level == Symbol)

    [[nodiscard]] uint64_t size() const noexcept { return end - start; }
    [[nodiscard]] bool contains(uint64_t addr) const noexcept {
        return addr >= start && addr < end;
    }
    [[nodiscard]] bool overlaps(uint64_t s, uint64_t e) const noexcept {
        return s < end && e > start;
    }
};

// ---------------------------------------------------------------------------
// RangeMap — stores non-overlapping attributed intervals
//
// When a fine-grained symbol is inserted into a coarse section interval, the
// map splits the section interval so zero bytes are double-counted.
// After all insertions, any unclaimed bytes are attributed to [Gap/Padding].
// ---------------------------------------------------------------------------
class RangeMap {
public:
    RangeMap() = default;

    // Insert a new range. If it overlaps with existing ranges at the same or
    // coarser level, split them. Finer-grained inserts (higher level value)
    // carve out space from coarser ones.
    void insert(uint64_t start, uint64_t end, std::string label,
                AttributionLevel level,
                std::string section_name = {},
                std::string compile_unit = {})
    {
        if (start >= end) return; // zero-size range ignored

        RangeEntry entry{start, end, std::move(label), level,
                         std::move(section_name), std::move(compile_unit)};

        // Remove or trim any overlapping entries at coarser level
        std::vector<RangeEntry> survivors;
        survivors.reserve(entries_.size() + 3);

        for (auto& e : entries_) {
            if (!e.overlaps(start, end) || e.level >= level) {
                // No overlap or same/finer level — keep as-is
                survivors.push_back(std::move(e));
            } else {
                // e overlaps [start,end) and is coarser — split it
                if (e.start < start) {
                    // Left fragment
                    RangeEntry left = e;
                    left.end = start;
                    survivors.push_back(std::move(left));
                }
                if (e.end > end) {
                    // Right fragment
                    RangeEntry right = e;
                    right.start = end;
                    survivors.push_back(std::move(right));
                }
                // Middle portion [start,end) is consumed by the new entry
            }
        }

        survivors.push_back(std::move(entry));
        entries_ = std::move(survivors);
        sorted_ = false;
    }

    // Fill gaps in [file_start, file_end) with a gap label
    void fill_gaps(uint64_t file_start, uint64_t file_end,
                   const std::string& gap_label = "[Padding / Unaligned Gap]")
    {
        sort_if_needed();
        uint64_t cursor = file_start;
        std::vector<RangeEntry> gaps;
        for (const auto& e : entries_) {
            if (e.start > cursor && e.start <= file_end) {
                uint64_t gap_end = std::min(e.start, file_end);
                if (gap_end > cursor) {
                    gaps.push_back({cursor, gap_end, gap_label,
                                    AttributionLevel::Section, {}, {}});
                }
            }
            if (e.end > cursor) cursor = e.end;
        }
        if (cursor < file_end) {
            gaps.push_back({cursor, file_end, gap_label,
                            AttributionLevel::Section, {}, {}});
        }
        for (auto& g : gaps) entries_.push_back(std::move(g));
        sorted_ = false;
    }

    // Look up attribution at a given address
    [[nodiscard]] std::optional<const RangeEntry*> lookup(uint64_t addr) const {
        const_cast<RangeMap*>(this)->sort_if_needed();
        // Binary search
        auto it = std::lower_bound(entries_.begin(), entries_.end(), addr,
            [](const RangeEntry& e, uint64_t a) { return e.end <= a; });
        if (it != entries_.end() && it->contains(addr))
            return &*it;
        return std::nullopt;
    }

    // Sorted view of all entries
    [[nodiscard]] const std::vector<RangeEntry>& entries() const {
        const_cast<RangeMap*>(this)->sort_if_needed();
        return entries_;
    }

    // Total attributed bytes (sum of all ranges)
    [[nodiscard]] uint64_t total_attributed() const {
        uint64_t sum = 0;
        for (const auto& e : entries_) sum += e.size();
        return sum;
    }

    // Aggregate by label (sum sizes per unique label at any level)
    [[nodiscard]] std::vector<std::pair<std::string, uint64_t>>
    aggregate_by_label() const {
        const_cast<RangeMap*>(this)->sort_if_needed();
        std::vector<std::pair<std::string, uint64_t>> result;
        for (const auto& e : entries_) {
            auto it = std::find_if(result.begin(), result.end(),
                [&](const auto& p){ return p.first == e.label; });
            if (it != result.end()) it->second += e.size();
            else result.emplace_back(e.label, e.size());
        }
        std::sort(result.begin(), result.end(),
            [](const auto& a, const auto& b){ return a.second > b.second; });
        return result;
    }

    void clear() { entries_.clear(); sorted_ = false; }

private:
    void sort_if_needed() {
        if (!sorted_) {
            std::sort(entries_.begin(), entries_.end(),
                [](const RangeEntry& a, const RangeEntry& b) {
                    return a.start != b.start ? a.start < b.start
                                              : a.end < b.end;
                });
            sorted_ = true;
        }
    }

    std::vector<RangeEntry> entries_;
    bool sorted_ = false;
};

} // namespace dwarflens
