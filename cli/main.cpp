// SPDX-License-Identifier: MIT
// DwarfLens — cli/main.cpp
// Native CLI: dwarflens analyze|diff
#include "dwarflens/elf_parser.hpp"
#include "dwarflens/wasm_parser.hpp"
#include "dwarflens/dwarf_reader.hpp"
#include "dwarflens/struct_layout.hpp"
#include "dwarflens/diff_engine.hpp"
#include "dwarflens/json_serializer.hpp"

#include <algorithm>
#include <cstring>
#include <fstream>
#include <functional>
#include <iomanip>
#include <iostream>
#include <sstream>
#include <string>
#include <vector>

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
static std::vector<uint8_t> read_file(const std::string& path) {
    std::ifstream f(path, std::ios::binary);
    if (!f) return {};
    f.seekg(0, std::ios::end);
    auto size = static_cast<size_t>(f.tellg());
    f.seekg(0);
    std::vector<uint8_t> data(size);
    f.read(reinterpret_cast<char*>(data.data()), static_cast<std::streamsize>(size));
    return data;
}

static std::string human_size(int64_t bytes) {
    char buf[64];
    if (std::abs(bytes) < 1024)
        snprintf(buf, sizeof(buf), "%+lld B", (long long)bytes);
    else if (std::abs(bytes) < 1024 * 1024)
        snprintf(buf, sizeof(buf), "%+.1f KiB", bytes / 1024.0);
    else
        snprintf(buf, sizeof(buf), "%+.2f MiB", bytes / (1024.0 * 1024.0));
    return buf;
}

static std::string format_size(uint64_t bytes) {
    char buf[64];
    if (bytes < 1024)
        snprintf(buf, sizeof(buf), "%llu B", (unsigned long long)bytes);
    else if (bytes < 1024 * 1024)
        snprintf(buf, sizeof(buf), "%.1f KiB", bytes / 1024.0);
    else
        snprintf(buf, sizeof(buf), "%.2f MiB", bytes / (1024.0 * 1024.0));
    return buf;
}

// ---------------------------------------------------------------------------
// Build BinaryAnalysis from raw bytes
// ---------------------------------------------------------------------------
static dwarflens::BinaryAnalysis analyze_binary(
    const std::vector<uint8_t>& data, const std::string& filename)
{
    using namespace dwarflens;
    BinaryAnalysis analysis;
    analysis.filename  = filename;
    analysis.file_size = data.size();
    std::span<const uint8_t> sp(data);

    // Detect format by magic
    bool is_elf  = data.size() >= 4 &&
                   data[0] == 0x7F && data[1] == 'E' &&
                   data[2] == 'L'  && data[3] == 'F';
    bool is_wasm = data.size() >= 4 &&
                   data[0] == 0x00 && data[1] == 0x61 &&
                   data[2] == 0x73 && data[3] == 0x6D;

    bool is_macho = data.size() >= 4 &&
                    ((data[0] == 0xCF && data[1] == 0xFA && data[2] == 0xED && data[3] == 0xFE) ||
                     (data[0] == 0xFE && data[1] == 0xED && data[2] == 0xFA && data[3] == 0xCF));
    bool is_pe    = data.size() >= 64 && data[0] == 'M' && data[1] == 'Z';

    if (is_elf) {
        analysis.format = BinaryAnalysis::Format::ELF;
        auto elf_r = ElfParser::parse(sp, filename);
        if (elf_r) {
            const ElfParseResult& elf = *elf_r;
            analysis.elf = elf;
            analysis.flash_size = elf.flash_size();
            analysis.ram_size   = elf.ram_size();

            for (const auto& s : elf.sections) {
                BinaryAnalysis::SectionSummary ss;
                ss.name     = s.name;
                ss.size     = s.size;
                ss.vm_addr  = s.addr;
                switch (s.category) {
                    case SectionCategory::Code:      ss.category = "code";      break;
                    case SectionCategory::ROData:    ss.category = "rodata";    break;
                    case SectionCategory::RWData:    ss.category = "data";      break;
                    case SectionCategory::BSS:       ss.category = "bss";       break;
                    case SectionCategory::DebugInfo: ss.category = "debug";     break;
                    case SectionCategory::Metadata:  ss.category = "metadata";  break;
                    default:                         ss.category = "other";     break;
                }
                analysis.sections.push_back(std::move(ss));
            }

            for (const auto& sym : elf.symbols) {
                if (sym.size == 0) continue;
                BinaryAnalysis::SymbolSummary ss;
                ss.name           = sym.demangled_name;
                ss.raw_name       = sym.raw_name;
                ss.section        = sym.section_name;
                ss.compile_unit   = sym.compile_unit;
                ss.template_group = sym.template_group;
                ss.size           = sym.size;
                ss.type = (sym.type == kSTT_FUNC)   ? "func" :
                          (sym.type == kSTT_OBJECT)  ? "object" : "other";
                analysis.symbols.push_back(std::move(ss));
            }

            // Extract DWARF structs
            DwarfReader::Input dwarf_in;
            auto di = elf.section_data(".debug_info",   sp);
            auto da = elf.section_data(".debug_abbrev", sp);
            auto ds = elf.section_data(".debug_str",    sp);
            auto dl = elf.section_data(".debug_line_str", sp);
            if (di && da) {
                dwarf_in.debug_info   = *di;
                dwarf_in.debug_abbrev = *da;
                if (ds) dwarf_in.debug_str = *ds;
                if (dl) dwarf_in.debug_line_str = *dl;
                auto structs_r = DwarfReader::extract_structs(dwarf_in);
                if (structs_r) {
                    analysis.structs = std::move(*structs_r);
                    LayoutAnalyzer::analyze_all(analysis.structs);
                }
            }
        } else {
            std::cerr << "ELF parse error: " << elf_r.error().message() << "\n";
        }
    } else if (is_wasm) {
        analysis.format = BinaryAnalysis::Format::Wasm;
        auto wasm_r = WasmParser::parse(sp, filename);
        if (wasm_r) {
            const WasmParseResult& wasm = *wasm_r;
            analysis.wasm = wasm;
            analysis.flash_size = wasm.code_section_size + wasm.data_section_size;
            analysis.ram_size   = wasm.data_section_size;

            for (const auto& s : wasm.sections) {
                BinaryAnalysis::SectionSummary ss;
                ss.name    = s.id == WasmSectionId::Custom ? s.custom_name
                           : "wasm_section_" + std::to_string(static_cast<int>(s.id));
                ss.size    = s.payload_size;
                ss.category = s.id == WasmSectionId::Code ? "code" :
                              s.id == WasmSectionId::Data ? "data" :
                              s.is_debug ? "debug" : "metadata";
                analysis.sections.push_back(std::move(ss));
            }

            for (const auto& f : wasm.functions) {
                if (f.code_size == 0) continue;
                BinaryAnalysis::SymbolSummary ss;
                ss.name    = f.name;
                ss.section = "code";
                ss.size    = f.code_size;
                ss.type    = "func";
                analysis.symbols.push_back(std::move(ss));
            }
        } else {
            std::cerr << "Wasm parse error: " << wasm_r.error().message() << "\n";
        }
    } else if (is_macho) {
        analysis.format = BinaryAnalysis::Format::MachO;
        auto macho_r = MachoParser::parse(sp, filename);
        if (macho_r) {
            const MachoParseResult& mo = *macho_r;
            analysis.macho = mo;
            analysis.flash_size = mo.flash_size();
            analysis.ram_size   = mo.ram_size();

            for (const auto& s : mo.sections) {
                BinaryAnalysis::SectionSummary ss;
                ss.name     = s.full_name;
                ss.size     = s.size;
                ss.vm_addr  = s.addr;
                switch (s.category) {
                    case SectionCategory::Code:      ss.category = "code";      break;
                    case SectionCategory::ROData:    ss.category = "rodata";    break;
                    case SectionCategory::RWData:    ss.category = "data";      break;
                    case SectionCategory::BSS:       ss.category = "bss";       break;
                    case SectionCategory::DebugInfo: ss.category = "debug";     break;
                    case SectionCategory::Metadata:  ss.category = "metadata";  break;
                    default:                         ss.category = "other";     break;
                }
                analysis.sections.push_back(std::move(ss));
            }

            for (const auto& sym : mo.symbols) {
                if (sym.size == 0) continue;
                BinaryAnalysis::SymbolSummary ss;
                ss.name           = sym.demangled_name;
                ss.raw_name       = sym.raw_name;
                ss.section        = sym.section_name;
                ss.template_group = sym.template_group;
                ss.size           = sym.size;
                ss.type           = "func";
                analysis.symbols.push_back(std::move(ss));
            }

            // Extract DWARF if embedded in Mach-O
            DwarfReader::Input dwarf_in;
            auto di = mo.section_data("__DWARF.__debug_info", sp);
            if (!di) di = mo.section_data("__debug_info", sp);
            auto da = mo.section_data("__DWARF.__debug_abbrev", sp);
            if (!da) da = mo.section_data("__debug_abbrev", sp);
            auto ds = mo.section_data("__DWARF.__debug_str", sp);
            if (!ds) ds = mo.section_data("__debug_str", sp);

            if (di && da) {
                dwarf_in.debug_info   = *di;
                dwarf_in.debug_abbrev = *da;
                if (ds) dwarf_in.debug_str = *ds;
                auto structs_r = DwarfReader::extract_structs(dwarf_in);
                if (structs_r) {
                    analysis.structs = std::move(*structs_r);
                    LayoutAnalyzer::analyze_all(analysis.structs);
                }
            }
        } else {
            std::cerr << "Mach-O parse error: " << macho_r.error().message() << "\n";
        }
    } else if (is_pe) {
        analysis.format = BinaryAnalysis::Format::PE;
        auto pe_r = PeParser::parse(sp, filename);
        if (pe_r) {
            const PeParseResult& pe = *pe_r;
            analysis.pe = pe;
            analysis.flash_size = pe.flash_size();
            analysis.ram_size   = pe.ram_size();

            for (const auto& s : pe.sections) {
                BinaryAnalysis::SectionSummary ss;
                ss.name     = s.name;
                ss.size     = s.raw_size > 0 ? s.raw_size : s.virtual_size;
                ss.vm_addr  = pe.image_base + s.virtual_addr;
                switch (s.category) {
                    case SectionCategory::Code:      ss.category = "code";      break;
                    case SectionCategory::ROData:    ss.category = "rodata";    break;
                    case SectionCategory::RWData:    ss.category = "data";      break;
                    case SectionCategory::BSS:       ss.category = "bss";       break;
                    case SectionCategory::DebugInfo: ss.category = "debug";     break;
                    case SectionCategory::Metadata:  ss.category = "metadata";  break;
                    default:                         ss.category = "other";     break;
                }
                analysis.sections.push_back(std::move(ss));
            }

            // Extract DWARF if present (e.g. MinGW/Clang on Windows)
            DwarfReader::Input dwarf_in;
            auto di = pe.section_data(".debug_info", sp);
            auto da = pe.section_data(".debug_abbrev", sp);
            auto ds = pe.section_data(".debug_str", sp);
            if (di && da) {
                dwarf_in.debug_info   = *di;
                dwarf_in.debug_abbrev = *da;
                if (ds) dwarf_in.debug_str = *ds;
                auto structs_r = DwarfReader::extract_structs(dwarf_in);
                if (structs_r) {
                    analysis.structs = std::move(*structs_r);
                    LayoutAnalyzer::analyze_all(analysis.structs);
                }
            }
        } else {
            std::cerr << "PE/COFF parse error: " << pe_r.error().message() << "\n";
        }
    } else {
        std::cerr << "Unknown binary format (expected ELF, WebAssembly, Mach-O, or PE/COFF)\n";
    }

    return analysis;
}

// ---------------------------------------------------------------------------
// Output formatters
// ---------------------------------------------------------------------------
static std::string format_binary_type(dwarflens::BinaryAnalysis::Format f) {
    switch (f) {
        case dwarflens::BinaryAnalysis::Format::ELF:   return "ELF";
        case dwarflens::BinaryAnalysis::Format::Wasm:  return "Wasm";
        case dwarflens::BinaryAnalysis::Format::MachO: return "Mach-O";
        case dwarflens::BinaryAnalysis::Format::PE:    return "PE/COFF";
    }
    return "Unknown";
}

static void print_table_analyze(const dwarflens::BinaryAnalysis& a) {
    using namespace std;
    const int W = 60, SW = 12, CW = 12;
    auto line = [&]{ cout << string(W + SW + CW + 4, '-') << "\n"; };

    cout << "\n🔍 DwarfLens Analysis: " << a.filename << "\n";
    cout << "   Format: " << format_binary_type(a.format)
         << "   File size: " << format_size(a.file_size)
         << "   Flash: " << format_size(a.flash_size)
         << "   RAM: " << format_size(a.ram_size) << "\n\n";

    line();
    cout << left << setw(W) << "Section" << right << setw(SW) << "Size" << setw(CW) << "Category" << "\n";
    line();
    for (const auto& s : a.sections) {
        if (s.size == 0) continue;
        cout << left << setw(W) << s.name.substr(0, W-1)
             << right << setw(SW) << format_size(s.size)
             << setw(CW) << s.category << "\n";
    }
    line();

    // Top 20 symbols
    auto syms = a.symbols;
    sort(syms.begin(), syms.end(),
        [](const auto& x, const auto& y){ return x.size > y.size; });
    if (syms.size() > 20) syms.resize(20);

    if (!syms.empty()) {
        cout << "\n📊 Top Symbols by Size:\n";
        line();
        cout << left << setw(W) << "Symbol" << right << setw(SW) << "Size" << setw(CW) << "Type" << "\n";
        line();
        for (const auto& s : syms) {
            std::string display = s.name.empty() ? s.raw_name : s.name;
            if (display.size() > W-1) display = display.substr(0, W-4) + "...";
            cout << left << setw(W) << display << right << setw(SW) << format_size(s.size) << setw(CW) << s.type << "\n";
        }
        line();
    }

    // Structs
    if (!a.structs.empty()) {
        cout << "\n🏗️  DWARF Struct Layouts (" << a.structs.size() << " structs):\n";
        auto structs = a.structs;
        sort(structs.begin(), structs.end(),
            [](const auto& x, const auto& y){ return x.total_padding_bytes > y.total_padding_bytes; });
        if (structs.size() > 10) structs.resize(10);

        for (const auto& sl : structs) {
            cout << "\n  " << sl.tag << " " << sl.name
                 << " { size=" << sl.byte_size
                 << "B, padding=" << sl.total_padding_bytes
                 << "B, cache_lines=" << sl.cache_lines_spanned;
            if (sl.has_cache_line_crossing()) cout << " ⚠️  cache-line split!";
            cout << " }\n";
            for (const auto& m : sl.members) {
                cout << "    +" << setw(4) << m.offset
                     << "  " << left << setw(30) << m.type_name.substr(0,29)
                     << " " << m.name << "\n";
            }
            if (sl.optimal.has_value() && sl.optimal->bytes_saved > 0) {
                cout << "    💡 Reorder saves " << sl.optimal->bytes_saved << " bytes\n";
            }
        }
    }
}

static void print_table_diff(const dwarflens::DiffResult& diff) {
    using namespace std;
    const int W = 50, SW = 14, DW = 12, PW = 10;
    auto line = [&]{ cout << string(W + SW + DW + PW + 4, '-') << "\n"; };

    cout << "\n🔀 DwarfLens Diff: " << diff.base_filename
         << " → " << diff.target_filename << "\n\n";

    cout << "  File size: " << human_size(diff.file_size_delta)
         << " (" << fixed << setprecision(2) << diff.file_size_pct << "%)\n";
    cout << "  Flash:     " << human_size(diff.flash_delta)
         << " (" << diff.flash_pct << "%)\n";
    cout << "  RAM:       " << human_size(diff.ram_delta)
         << " (" << diff.ram_pct << "%)\n";

    if (diff.exceeded_growth_threshold)
        cout << "\n  ❌ EXCEEDED growth threshold of "
             << diff.growth_threshold_bytes << " bytes!\n";
    if (diff.has_padding_regression)
        cout << "  ❌ PADDING REGRESSION detected!\n";

    // Section deltas
    auto sections = diff.section_deltas;
    sections.erase(remove_if(sections.begin(), sections.end(),
        [](const auto& s){ return s.delta_bytes == 0; }), sections.end());

    if (!sections.empty()) {
        cout << "\n📦 Section Deltas:\n";
        line();
        cout << left << setw(W) << "Section"
             << right << setw(SW) << "Base" << setw(DW) << "Delta" << setw(PW) << "%" << "\n";
        line();
        for (const auto& s : sections) {
            char sign = s.delta_bytes > 0 ? '+' : ' ';
            cout << left << setw(W) << s.name.substr(0,W-1)
                 << right << setw(SW) << format_size(s.base_size)
                 << setw(DW) << (sign + human_size(s.delta_bytes))
                 << setw(PW) << (string(1, sign) + to_string((int)abs(s.delta_pct)) + "%")
                 << "\n";
        }
        line();
    }

    // Symbol deltas
    auto syms = diff.symbol_deltas;
    if (syms.size() > 20) syms.resize(20);
    if (!syms.empty()) {
        cout << "\n📊 Top Symbol Deltas:\n";
        line();
        cout << left << setw(W) << "Symbol"
             << right << setw(SW) << "Base" << setw(DW) << "Delta" << "\n";
        line();
        for (const auto& s : syms) {
            std::string display = s.name.size() > W-1 ? s.name.substr(0,W-4)+"..." : s.name;
            cout << left << setw(W) << display
                 << right << setw(SW) << format_size(s.base_size)
                 << setw(DW) << human_size(s.delta_bytes) << "\n";
        }
        line();
    }

    // Struct regressions
    if (!diff.struct_regressions.empty()) {
        cout << "\n🏗️  Struct Regressions:\n";
        for (const auto& r : diff.struct_regressions) {
            cout << "  " << (r.is_regression ? "❌" : "✅") << " "
                 << r.name
                 << " size:" << human_size(r.size_delta)
                 << " padding:" << human_size(r.padding_delta)
                 << " cache_lines:" << human_size(r.cache_line_delta) << "\n";
        }
    }
}

static std::string make_markdown_analyze(const dwarflens::BinaryAnalysis& a) {
    std::ostringstream o;
    o << "# DwarfLens Analysis: `" << a.filename << "`\n\n";
    o << "| Metric | Value |\n|--------|-------|\n";
    o << "| Format | " << format_binary_type(a.format) << " |\n";
    o << "| File Size | " << format_size(a.file_size) << " |\n";
    o << "| Flash | " << format_size(a.flash_size) << " |\n";
    o << "| RAM | " << format_size(a.ram_size) << " |\n\n";

    o << "## Sections\n\n";
    o << "| Section | Size | Category |\n|---------|------|----------|\n";
    for (const auto& s : a.sections) {
        if (s.size == 0) continue;
        o << "| `" << s.name << "` | " << format_size(s.size) << " | " << s.category << " |\n";
    }
    o << "\n";

    auto syms = a.symbols;
    std::sort(syms.begin(), syms.end(), [](const auto& x, const auto& y){ return x.size > y.size; });
    if (syms.size() > 20) syms.resize(20);
    if (!syms.empty()) {
        o << "## Top 20 Symbols\n\n";
        o << "| Symbol | Size | Type |\n|--------|------|------|\n";
        for (const auto& s : syms)
            o << "| `" << s.name << "` | " << format_size(s.size) << " | " << s.type << " |\n";
        o << "\n";
    }

    if (!a.structs.empty()) {
        o << "## DWARF Struct Layouts\n\n";
        for (const auto& sl : a.structs) {
            o << "### `" << sl.tag << " " << sl.name << "`\n\n";
            o << "- Size: " << sl.byte_size << " bytes\n";
            o << "- Padding: " << sl.total_padding_bytes << " bytes\n";
            o << "- Cache lines: " << sl.cache_lines_spanned << "\n\n";
            o << "| Field | Type | Offset | Size |\n|-------|------|--------|------|\n";
            for (const auto& m : sl.members)
                o << "| `" << m.name << "` | `" << m.type_name << "` | +"
                  << m.offset << " | " << m.byte_size << " |\n";
            if (sl.optimal.has_value())
                o << "\n**Optimal reordering saves " << sl.optimal->bytes_saved << " bytes:**\n\n```cpp\n"
                  << sl.optimal->cpp_snippet << "\n```\n";
            o << "\n";
        }
    }
    return o.str();
}

static std::string make_markdown_diff(const dwarflens::DiffResult& diff) {
    std::ostringstream o;
    o << "# DwarfLens Diff Report\n\n";
    o << "**Base:** `" << diff.base_filename << "`  \n";
    o << "**Target:** `" << diff.target_filename << "`\n\n";
    o << "| Metric | Delta | % |\n|--------|-------|---|\n";
    o << "| File Size | " << human_size(diff.file_size_delta) << " | "
      << std::fixed << std::setprecision(2) << diff.file_size_pct << "% |\n";
    o << "| Flash | " << human_size(diff.flash_delta) << " | " << diff.flash_pct << "% |\n";
    o << "| RAM | " << human_size(diff.ram_delta) << " | " << diff.ram_pct << "% |\n\n";

    if (diff.exceeded_growth_threshold)
        o << "> ❌ **FAILED**: Exceeded growth threshold of " << diff.growth_threshold_bytes << " bytes\n\n";
    if (diff.has_padding_regression)
        o << "> ❌ **FAILED**: Padding regression detected\n\n";

    auto sections = diff.section_deltas;
    sections.erase(std::remove_if(sections.begin(), sections.end(),
        [](const auto& s){ return s.delta_bytes == 0; }), sections.end());
    if (!sections.empty()) {
        o << "## Section Deltas\n\n";
        o << "| Section | Base | Delta |\n|---------|------|-------|\n";
        for (const auto& s : sections)
            o << "| `" << s.name << "` | " << format_size(s.base_size)
              << " | " << human_size(s.delta_bytes) << " |\n";
        o << "\n";
    }

    auto syms = diff.symbol_deltas;
    if (syms.size() > 20) syms.resize(20);
    if (!syms.empty()) {
        o << "## Top Symbol Deltas\n\n";
        o << "| Symbol | Base | Delta |\n|--------|------|-------|\n";
        for (const auto& s : syms)
            o << "| `" << s.name << "` | " << format_size(s.base_size)
              << " | " << human_size(s.delta_bytes) << " |\n";
        o << "\n";
    }
    return o.str();
}

// ---------------------------------------------------------------------------
// Usage
// ---------------------------------------------------------------------------
static void usage(const char* prog) {
    std::cerr << "Usage:\n"
              << "  " << prog << " analyze <binary> [--format=table|json|markdown]\n"
              << "  " << prog << " diff <base> <target> [--format=table|json|markdown]\n"
              << "                                      [--max-growth-bytes=N]\n"
              << "                                      [--fail-on-padding-regression]\n\n"
              << "Examples:\n"
              << "  " << prog << " analyze myprogram\n"
              << "  " << prog << " diff base.elf head.elf --format=markdown\n"
              << "  " << prog << " diff a.out b.out --max-growth-bytes=4096 --fail-on-padding-regression\n";
}

int main(int argc, char* argv[]) {
    if (argc < 3) { usage(argv[0]); return 1; }

    std::string cmd = argv[1];
    std::string format = "table";
    int64_t max_growth = -1;
    bool fail_padding = false;

    // Parse flags
    for (int i = 2; i < argc; ++i) {
        std::string arg = argv[i];
        if (arg.starts_with("--format=")) format = arg.substr(9);
        else if (arg.starts_with("--max-growth-bytes="))
            max_growth = std::stoll(arg.substr(19));
        else if (arg == "--fail-on-padding-regression") fail_padding = true;
    }

    if (cmd == "analyze") {
        std::string path = argv[2];
        auto data = read_file(path);
        if (data.empty()) {
            std::cerr << "Cannot read file: " << path << "\n";
            return 1;
        }
        auto analysis = analyze_binary(data, path);

        if (format == "json") {
            std::cout << dwarflens::JsonSerializer::serialize(analysis) << "\n";
        } else if (format == "markdown") {
            std::cout << make_markdown_analyze(analysis);
        } else {
            print_table_analyze(analysis);
        }
        return 0;

    } else if (cmd == "diff") {
        if (argc < 4) { usage(argv[0]); return 1; }
        std::string base_path   = argv[2];
        std::string target_path = argv[3];

        auto base_data   = read_file(base_path);
        auto target_data = read_file(target_path);
        if (base_data.empty())   { std::cerr << "Cannot read: " << base_path   << "\n"; return 1; }
        if (target_data.empty()) { std::cerr << "Cannot read: " << target_path << "\n"; return 1; }

        auto base_analysis   = analyze_binary(base_data,   base_path);
        auto target_analysis = analyze_binary(target_data, target_path);

        auto diff = dwarflens::DiffEngine::diff(base_analysis, target_analysis);
        dwarflens::DiffEngine::apply_thresholds(diff, max_growth, fail_padding);

        if (format == "json") {
            std::cout << dwarflens::JsonSerializer::serialize(diff) << "\n";
        } else if (format == "markdown") {
            std::cout << make_markdown_diff(diff);
        } else {
            print_table_diff(diff);
        }

        // Exit with failure code if thresholds exceeded
        if (diff.exceeded_growth_threshold || diff.has_padding_regression) return 1;
        return 0;

    } else {
        std::cerr << "Unknown command: " << cmd << "\n";
        usage(argv[0]);
        return 1;
    }
}
