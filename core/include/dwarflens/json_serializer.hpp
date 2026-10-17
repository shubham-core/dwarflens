// SPDX-License-Identifier: MIT
// DwarfLens — json_serializer.hpp
// JSON serialization for all analysis result types (header-only).
#pragma once
#include "diff_engine.hpp"
#include "struct_layout.hpp"
#include <sstream>
#include <string>

namespace dwarflens {

// Minimal JSON builder — no external dependencies
class JsonBuilder {
public:
    static std::string quote(const std::string& s) {
        std::string out;
        out.reserve(s.size() + 2);
        out += '"';
        for (char c : s) {
            switch (c) {
                case '"':  out += "\\\""; break;
                case '\\': out += "\\\\"; break;
                case '\n': out += "\\n";  break;
                case '\r': out += "\\r";  break;
                case '\t': out += "\\t";  break;
                default:
                    if (static_cast<uint8_t>(c) < 0x20) {
                        char buf[8];
                        snprintf(buf, sizeof(buf), "\\u%04x",
                                 static_cast<uint8_t>(c));
                        out += buf;
                    } else {
                        out += c;
                    }
            }
        }
        out += '"';
        return out;
    }

    static std::string kv(const std::string& key, const std::string& val) {
        return quote(key) + ": " + quote(val);
    }
    static std::string kv(const std::string& key, int64_t val) {
        return quote(key) + ": " + std::to_string(val);
    }
    static std::string kv(const std::string& key, uint64_t val) {
        return quote(key) + ": " + std::to_string(val);
    }
    static std::string kv(const std::string& key, double val) {
        char buf[32]; snprintf(buf, sizeof(buf), "%.4f", val);
        return quote(key) + ": " + buf;
    }
    static std::string kv(const std::string& key, bool val) {
        return quote(key) + ": " + (val ? "true" : "false");
    }
};

// ---------------------------------------------------------------------------
// Serializer
// ---------------------------------------------------------------------------
class JsonSerializer {
public:
    [[nodiscard]] static std::string serialize(const BinaryAnalysis& analysis);
    [[nodiscard]] static std::string serialize(const DiffResult& diff);
    [[nodiscard]] static std::string serialize(const StructLayout& layout);
    [[nodiscard]] static std::string serialize(const std::vector<StructLayout>& layouts);

};

} // namespace dwarflens
