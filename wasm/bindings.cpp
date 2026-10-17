// SPDX-License-Identifier: MIT
// DwarfLens — wasm/bindings.cpp
// Emscripten C++ bindings exposing analyzeBinary() and diffBinaries() to JS.
// Compile with emcc: see build-wasm.sh

#include "dwarflens/elf_parser.hpp"
#include "dwarflens/wasm_parser.hpp"
#include "dwarflens/dwarf_reader.hpp"
#include "dwarflens/struct_layout.hpp"
#include "dwarflens/diff_engine.hpp"
#include "dwarflens/json_serializer.hpp"

#include <cstdint>
#include <cstring>
#include <span>
#include <string>
#include <vector>

#ifdef __EMSCRIPTEN__
#include <emscripten/emscripten.h>
#endif

// ---------------------------------------------------------------------------
// Internal: build BinaryAnalysis from raw bytes
// ---------------------------------------------------------------------------
static dwarflens::BinaryAnalysis analyze_bytes(
    const uint8_t* data, size_t size, const std::string& filename)
{
    using namespace dwarflens;
    BinaryAnalysis analysis;
    analysis.filename  = filename;
    analysis.file_size = size;
    std::span<const uint8_t> sp(data, size);

    bool is_elf  = size >= 4 && data[0] == 0x7F && data[1] == 'E' &&
                   data[2] == 'L' && data[3] == 'F';
    bool is_wasm = size >= 4 && data[0] == 0x00 && data[1] == 0x61 &&
                   data[2] == 0x73 && data[3] == 0x6D;

    if (is_elf) {
        analysis.format = BinaryAnalysis::Format::ELF;
        auto elf_r = ElfParser::parse(sp, filename);
        if (elf_r) {
            const ElfParseResult& elf = *elf_r;
            analysis.elf        = elf;
            analysis.flash_size = elf.flash_size();
            analysis.ram_size   = elf.ram_size();

            for (const auto& s : elf.sections) {
                BinaryAnalysis::SectionSummary ss;
                ss.name    = s.name;
                ss.size    = s.size;
                ss.vm_addr = s.addr;
                switch (s.category) {
                    case SectionCategory::Code:      ss.category = "code";     break;
                    case SectionCategory::ROData:    ss.category = "rodata";   break;
                    case SectionCategory::RWData:    ss.category = "data";     break;
                    case SectionCategory::BSS:       ss.category = "bss";      break;
                    case SectionCategory::DebugInfo: ss.category = "debug";    break;
                    case SectionCategory::Metadata:  ss.category = "metadata"; break;
                    default:                         ss.category = "other";    break;
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
                ss.type = (sym.type == kSTT_FUNC) ? "func" :
                          (sym.type == kSTT_OBJECT) ? "object" : "other";
                analysis.symbols.push_back(std::move(ss));
            }

            // DWARF extraction
            DwarfReader::Input di;
            auto debug_info   = elf.section_data(".debug_info",    sp);
            auto debug_abbrev = elf.section_data(".debug_abbrev",  sp);
            auto debug_str    = elf.section_data(".debug_str",     sp);
            auto debug_ls     = elf.section_data(".debug_line_str",sp);
            if (debug_info && debug_abbrev) {
                di.debug_info   = *debug_info;
                di.debug_abbrev = *debug_abbrev;
                if (debug_str) di.debug_str = *debug_str;
                if (debug_ls)  di.debug_line_str = *debug_ls;
                auto structs_r = DwarfReader::extract_structs(di);
                if (structs_r) {
                    analysis.structs = std::move(*structs_r);
                    LayoutAnalyzer::analyze_all(analysis.structs);
                }
            }
        }
    } else if (is_wasm) {
        analysis.format = BinaryAnalysis::Format::Wasm;
        auto wasm_r = WasmParser::parse(sp, filename);
        if (wasm_r) {
            const WasmParseResult& wasm = *wasm_r;
            analysis.wasm       = wasm;
            analysis.flash_size = wasm.code_section_size + wasm.data_section_size;
            analysis.ram_size   = wasm.data_section_size;

            for (const auto& s : wasm.sections) {
                BinaryAnalysis::SectionSummary ss;
                ss.name = s.id == WasmSectionId::Custom ? s.custom_name
                        : "wasm_section_" + std::to_string(static_cast<int>(s.id));
                ss.size = s.payload_size;
                ss.category = s.id == WasmSectionId::Code ? "code" :
                              s.id == WasmSectionId::Data ? "data" :
                              s.is_debug ? "debug" : "metadata";
                analysis.sections.push_back(std::move(ss));
            }

            for (const auto& f : wasm.functions) {
                if (f.code_size == 0) continue;
                BinaryAnalysis::SymbolSummary ss;
                ss.name = f.name; ss.section = "code";
                ss.size = f.code_size; ss.type = "func";
                analysis.symbols.push_back(std::move(ss));
            }
        }
    } else if (size >= 4 &&
               ((data[0] == 0xCF && data[1] == 0xFA && data[2] == 0xED && data[3] == 0xFE) ||
                (data[0] == 0xFE && data[1] == 0xED && data[2] == 0xFA && data[3] == 0xCF))) {
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
                    case SectionCategory::Code:      ss.category = "code";     break;
                    case SectionCategory::ROData:    ss.category = "rodata";   break;
                    case SectionCategory::RWData:    ss.category = "data";     break;
                    case SectionCategory::BSS:       ss.category = "bss";      break;
                    case SectionCategory::DebugInfo: ss.category = "debug";    break;
                    case SectionCategory::Metadata:  ss.category = "metadata"; break;
                    default:                         ss.category = "other";    break;
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
        }
    } else if (size >= 64 && data[0] == 'M' && data[1] == 'Z') {
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
                    case SectionCategory::Code:      ss.category = "code";     break;
                    case SectionCategory::ROData:    ss.category = "rodata";   break;
                    case SectionCategory::RWData:    ss.category = "data";     break;
                    case SectionCategory::BSS:       ss.category = "bss";      break;
                    case SectionCategory::DebugInfo: ss.category = "debug";    break;
                    case SectionCategory::Metadata:  ss.category = "metadata"; break;
                    default:                         ss.category = "other";    break;
                }
                analysis.sections.push_back(std::move(ss));
            }
        }
    }

    return analysis;
}

// ---------------------------------------------------------------------------
// C-compatible exports (called from JS via ccall/cwrap)
// ---------------------------------------------------------------------------
extern "C" {

// Analyze a single binary.
// Returns a heap-allocated JSON C-string. Caller must free() it.
#ifdef __EMSCRIPTEN__
EMSCRIPTEN_KEEPALIVE
#endif
char* analyzeBinary(const uint8_t* data, size_t size, const char* filename) {
    if (!data || size == 0) {
        const char* err = "{\"error\": \"empty input\"}";
        char* result = static_cast<char*>(malloc(strlen(err) + 1));
        if (result) strcpy(result, err);
        return result;
    }

    std::string json;
    try {
        auto analysis = analyze_bytes(data, size, filename ? filename : "binary");
        json = dwarflens::JsonSerializer::serialize(analysis);
    } catch (...) {
        json = "{\"error\": \"internal analysis error\"}";
    }

    char* result = static_cast<char*>(malloc(json.size() + 1));
    if (result) memcpy(result, json.c_str(), json.size() + 1);
    return result;
}

// Diff two binaries.
// Returns a heap-allocated JSON C-string. Caller must free() it.
#ifdef __EMSCRIPTEN__
EMSCRIPTEN_KEEPALIVE
#endif
char* diffBinaries(
    const uint8_t* base_data,   size_t base_size,   const char* base_name,
    const uint8_t* target_data, size_t target_size, const char* target_name)
{
    if (!base_data || !target_data) {
        const char* err = "{\"error\": \"null input\"}";
        char* result = static_cast<char*>(malloc(strlen(err) + 1));
        if (result) strcpy(result, err);
        return result;
    }

    std::string json;
    try {
        auto base   = analyze_bytes(base_data,   base_size,   base_name   ? base_name   : "base");
        auto target = analyze_bytes(target_data, target_size, target_name ? target_name : "target");
        auto diff   = dwarflens::DiffEngine::diff(base, target);
        // Also include both analyses in response
        std::string combined = "{\n";
        combined += "  \"diff\": " + dwarflens::JsonSerializer::serialize(diff) + ",\n";
        combined += "  \"base\": " + dwarflens::JsonSerializer::serialize(base) + ",\n";
        combined += "  \"target\": " + dwarflens::JsonSerializer::serialize(target) + "\n";
        combined += "}";
        json = combined;
    } catch (...) {
        json = "{\"error\": \"internal diff error\"}";
    }

    char* result = static_cast<char*>(malloc(json.size() + 1));
    if (result) memcpy(result, json.c_str(), json.size() + 1);
    return result;
}

// Version string
#ifdef __EMSCRIPTEN__
EMSCRIPTEN_KEEPALIVE
#endif
const char* dwarflensVersion() {
    return "0.1.0";
}

} // extern "C"
