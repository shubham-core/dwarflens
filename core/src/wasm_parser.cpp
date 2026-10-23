// SPDX-License-Identifier: MIT
// DwarfLens — wasm_parser.cpp
// Implementation of WebAssembly binary parser per WebAssembly Binary Spec §5.

#include "dwarflens/wasm_parser.hpp"
#include <algorithm>
#include <cstring>
#include <string>
#include <string_view>
#include <system_error>
#include <vector>

namespace dwarflens {

namespace {

enum class WasmParseError : int {
    InvalidMagic = 1,
    UnsupportedVersion,
    MalformedSection,
    MalformedData,
};

struct WasmParseErrorCategory : std::error_category {
    const char* name() const noexcept override { return "dwarflens.wasm"; }
    std::string message(int ev) const override {
        switch (static_cast<WasmParseError>(ev)) {
            case WasmParseError::InvalidMagic:       return "invalid WebAssembly magic header";
            case WasmParseError::UnsupportedVersion: return "unsupported WebAssembly version";
            case WasmParseError::MalformedSection:   return "malformed WebAssembly section";
            case WasmParseError::MalformedData:      return "malformed WebAssembly payload";
        }
        return "unknown WebAssembly error";
    }
};

const WasmParseErrorCategory& wasm_parse_error_category() noexcept {
    static WasmParseErrorCategory cat;
    return cat;
}

std::error_code make_wasm_error(WasmParseError e) noexcept {
    return {static_cast<int>(e), wasm_parse_error_category()};
}

std::string section_id_to_name(WasmSectionId id) {
    switch (id) {
        case WasmSectionId::Custom:    return "Custom";
        case WasmSectionId::Type:      return "Type";
        case WasmSectionId::Import:    return "Import";
        case WasmSectionId::Function:  return "Function";
        case WasmSectionId::Table:     return "Table";
        case WasmSectionId::Memory:    return "Memory";
        case WasmSectionId::Global:    return "Global";
        case WasmSectionId::Export:    return "Export";
        case WasmSectionId::Start:     return "Start";
        case WasmSectionId::Element:   return "Element";
        case WasmSectionId::Code:      return "Code";
        case WasmSectionId::Data:      return "Data";
        case WasmSectionId::DataCount: return "DataCount";
        default:                       return "Unknown";
    }
}

} // anonymous namespace

// ---------------------------------------------------------------------------
// WasmParser::parse_name_section
// ---------------------------------------------------------------------------
std::expected<void, std::error_code>
WasmParser::parse_name_section(std::span<const uint8_t> payload,
                               std::vector<WasmFunction>& functions,
                               uint32_t num_imports)
{
    SpanReader rdr(payload);

    // If caller passed the full custom section payload including "name" string prefix,
    // consume the prefix before iterating over subsections.
    if (rdr.remaining() >= 5) {
        size_t saved_pos = rdr.cursor();
        auto name_len_res = rdr.read_uleb128();
        if (name_len_res && *name_len_res == 4 && rdr.remaining() >= 4) {
            auto name_bytes = rdr.read_bytes(4);
            if (name_bytes && std::memcmp(name_bytes->data(), "name", 4) == 0) {
                // Successfully consumed "name" custom section name
            } else {
                (void)rdr.seek(saved_pos);
            }
        } else {
            (void)rdr.seek(saved_pos);
        }
    }

    // Subsections: subsection_id(u8), subsection_size(ULEB128), payload
    while (!rdr.empty()) {
        auto id_res = rdr.read_u8();
        if (!id_res) return std::unexpected(id_res.error());
        uint8_t sub_id = *id_res;

        auto size_res = rdr.read_uleb128();
        if (!size_res) return std::unexpected(size_res.error());
        uint64_t sub_size = *size_res;

        if (sub_size > rdr.remaining()) {
            return std::unexpected(make_error_code(ReadError::OutOfBounds));
        }

        if (sub_id == 1) { // Function names map
            auto sub_bytes_res = rdr.read_bytes(sub_size);
            if (!sub_bytes_res) return std::unexpected(sub_bytes_res.error());

            SpanReader sub_rdr(*sub_bytes_res);
            auto count_res = sub_rdr.read_uleb128();
            if (!count_res) return std::unexpected(count_res.error());
            uint64_t count = *count_res;

            for (uint64_t i = 0; i < count; ++i) {
                auto f_idx_res = sub_rdr.read_uleb128();
                if (!f_idx_res) return std::unexpected(f_idx_res.error());
                uint64_t f_idx = *f_idx_res;

                auto n_len_res = sub_rdr.read_uleb128();
                if (!n_len_res) return std::unexpected(n_len_res.error());
                uint64_t n_len = *n_len_res;

                auto n_bytes_res = sub_rdr.read_bytes(n_len);
                if (!n_bytes_res) return std::unexpected(n_bytes_res.error());

                std::string fn_name(reinterpret_cast<const char*>(n_bytes_res->data()),
                                    n_bytes_res->size());

                // Assign name to matching function in the function index space
                if (f_idx < functions.size() && functions[f_idx].index == f_idx) {
                    functions[f_idx].name = std::move(fn_name);
                } else if (f_idx >= num_imports &&
                           (f_idx - num_imports) < functions.size() &&
                           functions[f_idx - num_imports].index == f_idx) {
                    functions[f_idx - num_imports].name = std::move(fn_name);
                } else {
                    auto it = std::find_if(functions.begin(), functions.end(),
                                           [f_idx](const WasmFunction& f) {
                                               return f.index == f_idx;
                                           });
                    if (it != functions.end()) {
                        it->name = std::move(fn_name);
                    }
                }
            }
        } else {
            // Skip other subsections (e.g. module name, local names, etc.)
            auto skip_res = rdr.skip(sub_size);
            if (!skip_res) return std::unexpected(skip_res.error());
        }
    }

    return {};
}

// ---------------------------------------------------------------------------
// WasmParser::parse
// ---------------------------------------------------------------------------
std::expected<WasmParseResult, std::error_code>
WasmParser::parse(std::span<const uint8_t> data, std::string filename)
{
    SpanReader reader(data);

    // 1. Validate magic: 4 bytes \x00asm
    auto magic = reader.read_bytes(4);
    if (!magic) return std::unexpected(magic.error());
    if (std::memcmp(magic->data(), kWasmMagic, 4) != 0) {
        return std::unexpected(make_wasm_error(WasmParseError::InvalidMagic));
    }

    // Validate version: uint32_le == 1
    auto ver = reader.read_u32_le();
    if (!ver) return std::unexpected(ver.error());
    if (*ver != kWasmVersion) {
        return std::unexpected(make_wasm_error(WasmParseError::UnsupportedVersion));
    }

    WasmParseResult result;
    result.filename = std::move(filename);
    result.file_size = data.size();
    result.version = *ver;

    struct SectionRange {
        uint64_t start;
        uint64_t end;
        std::string label;
    };
    std::vector<SectionRange> section_ranges;

    struct CodeBodyInfo {
        uint64_t offset;
        uint64_t size;
    };
    std::vector<CodeBodyInfo> code_bodies;

    std::optional<std::span<const uint8_t>> name_section_payload;

    // 2. Parse sections
    while (!reader.empty()) {
        const size_t section_start_offset = reader.cursor();

        auto id_res = reader.read_u8();
        if (!id_res) return std::unexpected(id_res.error());
        const uint8_t raw_id = *id_res;

        auto size_res = reader.read_uleb128();
        if (!size_res) return std::unexpected(size_res.error());
        const uint64_t payload_size = *size_res;

        const size_t payload_offset = reader.cursor();
        if (payload_size > reader.remaining()) {
            return std::unexpected(make_error_code(ReadError::OutOfBounds));
        }

        const size_t section_end_offset = payload_offset + payload_size;
        const auto sec_id = static_cast<WasmSectionId>(raw_id);

        std::string custom_name;
        bool is_debug = false;

        SpanReader sec_reader(data.subspan(payload_offset, payload_size));

        switch (sec_id) {
            case WasmSectionId::Custom: {
                auto name_len_res = sec_reader.read_uleb128();
                if (!name_len_res) return std::unexpected(name_len_res.error());
                auto name_bytes = sec_reader.read_bytes(*name_len_res);
                if (!name_bytes) return std::unexpected(name_bytes.error());

                custom_name = std::string(
                    reinterpret_cast<const char*>(name_bytes->data()),
                    name_bytes->size());
                is_debug = custom_name.starts_with(".debug_");

                if (custom_name == "name") {
                    name_section_payload = data.subspan(payload_offset + sec_reader.cursor(),
                                                        sec_reader.remaining());
                }
                break;
            }

            case WasmSectionId::Type: {
                auto count_res = sec_reader.read_uleb128();
                if (!count_res) return std::unexpected(count_res.error());
                result.num_types = static_cast<uint32_t>(*count_res);

                for (uint32_t i = 0; i < result.num_types; ++i) {
                    auto form_res = sec_reader.read_u8();
                    if (!form_res) return std::unexpected(form_res.error());
                    if (*form_res == 0x60) {
                        auto p_count_res = sec_reader.read_uleb128();
                        if (!p_count_res) return std::unexpected(p_count_res.error());
                        auto skip_p = sec_reader.skip(*p_count_res);
                        if (!skip_p) return std::unexpected(skip_p.error());

                        auto r_count_res = sec_reader.read_uleb128();
                        if (!r_count_res) return std::unexpected(r_count_res.error());
                        auto skip_r = sec_reader.skip(*r_count_res);
                        if (!skip_r) return std::unexpected(skip_r.error());
                    } else {
                        return std::unexpected(make_wasm_error(WasmParseError::MalformedSection));
                    }
                }
                break;
            }

            case WasmSectionId::Import: {
                auto count_res = sec_reader.read_uleb128();
                if (!count_res) return std::unexpected(count_res.error());
                const uint64_t count = *count_res;

                for (uint64_t i = 0; i < count; ++i) {
                    auto mod_len_res = sec_reader.read_uleb128();
                    if (!mod_len_res) return std::unexpected(mod_len_res.error());
                    auto mod_bytes = sec_reader.read_bytes(*mod_len_res);
                    if (!mod_bytes) return std::unexpected(mod_bytes.error());
                    std::string mod_name(reinterpret_cast<const char*>(mod_bytes->data()),
                                         mod_bytes->size());

                    auto field_len_res = sec_reader.read_uleb128();
                    if (!field_len_res) return std::unexpected(field_len_res.error());
                    auto field_bytes = sec_reader.read_bytes(*field_len_res);
                    if (!field_bytes) return std::unexpected(field_bytes.error());
                    std::string field_name(reinterpret_cast<const char*>(field_bytes->data()),
                                           field_bytes->size());

                    auto kind_res = sec_reader.read_u8();
                    if (!kind_res) return std::unexpected(kind_res.error());
                    const uint8_t kind = *kind_res;

                    result.imports.push_back(WasmImport{
                        std::move(mod_name),
                        std::move(field_name),
                        kind
                    });

                    // Consume the import descriptor according to kind if present
                    if (!sec_reader.empty()) {
                        switch (kind) {
                            case 0: { // func: typeidx
                                auto type_idx = sec_reader.read_uleb128();
                                if (!type_idx) return std::unexpected(type_idx.error());
                                break;
                            }
                            case 1: { // table: elemtype + limits
                                auto elem_type = sec_reader.read_u8();
                                if (!elem_type) return std::unexpected(elem_type.error());
                                auto flags = sec_reader.read_u8();
                                if (!flags) return std::unexpected(flags.error());
                                auto min = sec_reader.read_uleb128();
                                if (!min) return std::unexpected(min.error());
                                if (*flags & 1) {
                                    auto max = sec_reader.read_uleb128();
                                    if (!max) return std::unexpected(max.error());
                                }
                                break;
                            }
                            case 2: { // mem: limits
                                auto flags = sec_reader.read_u8();
                                if (!flags) return std::unexpected(flags.error());
                                auto min = sec_reader.read_uleb128();
                                if (!min) return std::unexpected(min.error());
                                if (*flags & 1) {
                                    auto max = sec_reader.read_uleb128();
                                    if (!max) return std::unexpected(max.error());
                                }
                                break;
                            }
                            case 3: { // global: valtype + mut
                                auto valtype = sec_reader.read_u8();
                                if (!valtype) return std::unexpected(valtype.error());
                                auto mut = sec_reader.read_u8();
                                if (!mut) return std::unexpected(mut.error());
                                break;
                            }
                            default:
                                return std::unexpected(make_wasm_error(WasmParseError::MalformedSection));
                        }
                    }
                }
                break;
            }

            case WasmSectionId::Function: {
                auto count_res = sec_reader.read_uleb128();
                if (!count_res) return std::unexpected(count_res.error());
                const uint64_t num_funcs = *count_res;
                for (uint64_t i = 0; i < num_funcs; ++i) {
                    auto type_idx = sec_reader.read_uleb128();
                    if (!type_idx) return std::unexpected(type_idx.error());
                }
                break;
            }

            case WasmSectionId::Table: {
                auto count_res = sec_reader.read_uleb128();
                if (!count_res) return std::unexpected(count_res.error());
                result.num_tables = static_cast<uint32_t>(*count_res);
                break;
            }

            case WasmSectionId::Memory: {
                auto count_res = sec_reader.read_uleb128();
                if (!count_res) return std::unexpected(count_res.error());
                result.num_memories = static_cast<uint32_t>(*count_res);
                break;
            }

            case WasmSectionId::Global: {
                auto count_res = sec_reader.read_uleb128();
                if (!count_res) return std::unexpected(count_res.error());
                result.num_globals = static_cast<uint32_t>(*count_res);
                break;
            }

            case WasmSectionId::Export: {
                auto count_res = sec_reader.read_uleb128();
                if (!count_res) return std::unexpected(count_res.error());
                const uint64_t num_exports = *count_res;

                for (uint64_t i = 0; i < num_exports; ++i) {
                    auto name_len_res = sec_reader.read_uleb128();
                    if (!name_len_res) return std::unexpected(name_len_res.error());
                    auto name_bytes = sec_reader.read_bytes(*name_len_res);
                    if (!name_bytes) return std::unexpected(name_bytes.error());
                    std::string export_name(reinterpret_cast<const char*>(name_bytes->data()),
                                            name_bytes->size());

                    auto kind_res = sec_reader.read_u8();
                    if (!kind_res) return std::unexpected(kind_res.error());
                    const uint8_t kind = *kind_res;

                    auto idx_res = sec_reader.read_uleb128();
                    if (!idx_res) return std::unexpected(idx_res.error());
                    const uint32_t idx = static_cast<uint32_t>(*idx_res);

                    result.exports.push_back(WasmExport{
                        std::move(export_name),
                        kind,
                        idx
                    });
                }
                break;
            }

            case WasmSectionId::Code: {
                auto count_res = sec_reader.read_uleb128();
                if (!count_res) return std::unexpected(count_res.error());
                const uint64_t num_bodies = *count_res;

                for (uint64_t i = 0; i < num_bodies; ++i) {
                    auto body_size_res = sec_reader.read_uleb128();
                    if (!body_size_res) return std::unexpected(body_size_res.error());
                    const uint64_t body_size = *body_size_res;

                    const uint64_t body_offset = payload_offset + sec_reader.cursor();

                    if (body_size > sec_reader.remaining()) {
                        return std::unexpected(make_error_code(ReadError::OutOfBounds));
                    }

                    auto skip_res = sec_reader.skip(body_size);
                    if (!skip_res) return std::unexpected(skip_res.error());

                    result.code_section_size += body_size;
                    code_bodies.push_back(CodeBodyInfo{body_offset, body_size});
                }
                break;
            }

            case WasmSectionId::Data: {
                result.data_section_size += payload_size;
                break;
            }

            default:
                // Skip other sections (Start, Element, DataCount, etc.)
                break;
        }

        // Advance reader to the end of the section payload
        auto seek_res = reader.seek(section_end_offset);
        if (!seek_res) return std::unexpected(seek_res.error());

        std::string sec_label;
        if (sec_id == WasmSectionId::Custom && !custom_name.empty()) {
            sec_label = custom_name;
        } else {
            sec_label = section_id_to_name(sec_id);
        }

        section_ranges.push_back(SectionRange{
            section_start_offset,
            section_end_offset,
            sec_label
        });

        result.sections.push_back(WasmSection{
            sec_id,
            std::move(custom_name),
            payload_offset,
            payload_size,
            is_debug
        });
    }

    // 5. Assign function names:
    // First num_imports functions are imports.
    // Function bodies start at func index num_imports.
    // If name section provides names use them, else use func[N].

    uint32_t num_func_imports = 0;
    for (const auto& imp : result.imports) {
        if (imp.kind == 0) {
            WasmFunction fn;
            fn.index = num_func_imports;
            fn.name = "func[" + std::to_string(num_func_imports) + "]";
            fn.code_offset = 0;
            fn.code_size = 0;
            fn.is_import = true;
            result.functions.push_back(std::move(fn));
            ++num_func_imports;
        }
    }

    for (size_t i = 0; i < code_bodies.size(); ++i) {
        const uint32_t func_idx = num_func_imports + static_cast<uint32_t>(i);
        WasmFunction fn;
        fn.index = func_idx;
        fn.name = "func[" + std::to_string(func_idx) + "]";
        fn.code_offset = code_bodies[i].offset;
        fn.code_size = code_bodies[i].size;
        fn.is_import = false;
        result.functions.push_back(std::move(fn));
    }

    // Parse the name custom section if found
    if (name_section_payload) {
        auto name_res = parse_name_section(*name_section_payload,
                                           result.functions,
                                           num_func_imports);
        if (!name_res) {
            return std::unexpected(name_res.error());
        }
    }

    // 6. Build file_range_map:
    // Insert each section (by section id string) at AttributionLevel::Section.
    for (const auto& sr : section_ranges) {
        result.file_range_map.insert(sr.start, sr.end, sr.label, AttributionLevel::Section);
    }

    // Insert each code body at AttributionLevel::Symbol.
    for (const auto& fn : result.functions) {
        if (!fn.is_import && fn.code_size > 0) {
            result.file_range_map.insert(fn.code_offset, fn.code_offset + fn.code_size,
                                         fn.name, AttributionLevel::Symbol, "Code");
        }
    }

    return result;
}

} // namespace dwarflens
