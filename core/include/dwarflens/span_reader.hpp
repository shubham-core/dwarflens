// SPDX-License-Identifier: MIT
// DwarfLens — span_reader.hpp
// Zero-copy, bounds-checked binary reader over std::span<const uint8_t>.
#pragma once
#include <cstdint>
#include <cstring>
#include "expected.hpp"
#include <optional>
#include <span>
#include <string>
#include <string_view>
#include <system_error>

namespace dwarflens {

// ---------------------------------------------------------------------------
// Error type
// ---------------------------------------------------------------------------
enum class ReadError : int {
    OutOfBounds = 1,
    Overflow,
    InvalidString,
    MalformedLEB128,
};

struct ReadErrorCategory : std::error_category {
    const char* name() const noexcept override { return "dwarflens.read"; }
    std::string message(int ev) const override {
        switch (static_cast<ReadError>(ev)) {
            case ReadError::OutOfBounds:    return "read out of bounds";
            case ReadError::Overflow:       return "integer overflow";
            case ReadError::InvalidString:  return "unterminated or invalid string";
            case ReadError::MalformedLEB128: return "malformed LEB128 encoding";
        }
        return "unknown read error";
    }
};

inline const ReadErrorCategory& read_error_category() noexcept {
    static ReadErrorCategory cat;
    return cat;
}

inline std::error_code make_error_code(ReadError e) noexcept {
    return {static_cast<int>(e), read_error_category()};
}

template <typename T>
using ReadResult = std::expected<T, std::error_code>;

// ---------------------------------------------------------------------------
// SpanReader
// ---------------------------------------------------------------------------
class SpanReader {
public:
    explicit SpanReader(std::span<const uint8_t> data, size_t offset = 0)
        : data_(data), cursor_(offset) {}

    // Current read position
    [[nodiscard]] size_t cursor()    const noexcept { return cursor_; }
    [[nodiscard]] size_t remaining() const noexcept {
        return cursor_ <= data_.size() ? data_.size() - cursor_ : 0;
    }
    [[nodiscard]] bool empty()       const noexcept { return cursor_ >= data_.size(); }
    [[nodiscard]] size_t size()      const noexcept { return data_.size(); }

    // Seek to absolute offset (does not read)
    [[nodiscard]] ReadResult<void> seek(size_t offset) noexcept {
        if (offset > data_.size())
            return std::unexpected(make_error_code(ReadError::OutOfBounds));
        cursor_ = offset;
        return {};
    }

    // Skip n bytes
    [[nodiscard]] ReadResult<void> skip(size_t n) noexcept {
        if (n > remaining())
            return std::unexpected(make_error_code(ReadError::OutOfBounds));
        cursor_ += n;
        return {};
    }

    // Peek without advancing
    [[nodiscard]] std::optional<uint8_t> peek_u8() const noexcept {
        if (remaining() < 1) return std::nullopt;
        return data_[cursor_];
    }

    // -----------------------------------------------------------------------
    // Fixed-width integer reads (little-endian)
    // -----------------------------------------------------------------------
    [[nodiscard]] ReadResult<uint8_t> read_u8() noexcept {
        if (remaining() < 1)
            return std::unexpected(make_error_code(ReadError::OutOfBounds));
        return data_[cursor_++];
    }

    [[nodiscard]] ReadResult<int8_t> read_i8() noexcept {
        auto r = read_u8();
        if (!r) return std::unexpected(r.error());
        return static_cast<int8_t>(*r);
    }

    [[nodiscard]] ReadResult<uint16_t> read_u16_le() noexcept {
        if (remaining() < 2)
            return std::unexpected(make_error_code(ReadError::OutOfBounds));
        uint16_t v;
        std::memcpy(&v, data_.data() + cursor_, 2);
        cursor_ += 2;
        // Ensure little-endian on big-endian hosts (compile-time)
        if constexpr (__BYTE_ORDER__ == __ORDER_BIG_ENDIAN__)
            v = __builtin_bswap16(v);
        return v;
    }

    [[nodiscard]] ReadResult<uint32_t> read_u32_le() noexcept {
        if (remaining() < 4)
            return std::unexpected(make_error_code(ReadError::OutOfBounds));
        uint32_t v;
        std::memcpy(&v, data_.data() + cursor_, 4);
        cursor_ += 4;
        if constexpr (__BYTE_ORDER__ == __ORDER_BIG_ENDIAN__)
            v = __builtin_bswap32(v);
        return v;
    }

    [[nodiscard]] ReadResult<uint64_t> read_u64_le() noexcept {
        if (remaining() < 8)
            return std::unexpected(make_error_code(ReadError::OutOfBounds));
        uint64_t v;
        std::memcpy(&v, data_.data() + cursor_, 8);
        cursor_ += 8;
        if constexpr (__BYTE_ORDER__ == __ORDER_BIG_ENDIAN__)
            v = __builtin_bswap64(v);
        return v;
    }

    [[nodiscard]] ReadResult<uint16_t> read_u16_be() noexcept {
        if (remaining() < 2)
            return std::unexpected(make_error_code(ReadError::OutOfBounds));
        uint16_t v;
        std::memcpy(&v, data_.data() + cursor_, 2);
        cursor_ += 2;
        if constexpr (__BYTE_ORDER__ == __ORDER_LITTLE_ENDIAN__)
            v = __builtin_bswap16(v);
        return v;
    }

    [[nodiscard]] ReadResult<uint32_t> read_u32_be() noexcept {
        if (remaining() < 4)
            return std::unexpected(make_error_code(ReadError::OutOfBounds));
        uint32_t v;
        std::memcpy(&v, data_.data() + cursor_, 4);
        cursor_ += 4;
        if constexpr (__BYTE_ORDER__ == __ORDER_LITTLE_ENDIAN__)
            v = __builtin_bswap32(v);
        return v;
    }

    [[nodiscard]] ReadResult<uint64_t> read_u64_be() noexcept {
        if (remaining() < 8)
            return std::unexpected(make_error_code(ReadError::OutOfBounds));
        uint64_t v;
        std::memcpy(&v, data_.data() + cursor_, 8);
        cursor_ += 8;
        if constexpr (__BYTE_ORDER__ == __ORDER_LITTLE_ENDIAN__)
            v = __builtin_bswap64(v);
        return v;
    }

    // -----------------------------------------------------------------------
    // ULEB128 — unsigned variable-length base-128 integer (up to 64 bits)
    // -----------------------------------------------------------------------
    static constexpr int kMaxLEB128Iters = 10; // ceil(64/7)

    [[nodiscard]] ReadResult<uint64_t> read_uleb128() noexcept {
        uint64_t result = 0;
        int shift = 0;
        for (int i = 0; i < kMaxLEB128Iters; ++i) {
            if (remaining() < 1)
                return std::unexpected(make_error_code(ReadError::OutOfBounds));
            uint8_t byte = data_[cursor_++];
            if (shift < 64)
                result |= static_cast<uint64_t>(byte & 0x7F) << shift;
            shift += 7;
            if ((byte & 0x80) == 0)
                return result;
        }
        return std::unexpected(make_error_code(ReadError::MalformedLEB128));
    }

    // -----------------------------------------------------------------------
    // SLEB128 — signed variable-length base-128 integer (up to 64 bits)
    // -----------------------------------------------------------------------
    [[nodiscard]] ReadResult<int64_t> read_sleb128() noexcept {
        int64_t result = 0;
        int shift = 0;
        uint8_t byte = 0;
        for (int i = 0; i < kMaxLEB128Iters; ++i) {
            if (remaining() < 1)
                return std::unexpected(make_error_code(ReadError::OutOfBounds));
            byte = data_[cursor_++];
            if (shift < 64)
                result |= static_cast<int64_t>(byte & 0x7F) << shift;
            shift += 7;
            if ((byte & 0x80) == 0) {
                // Sign-extend if sign bit of last byte is set
                if (shift < 64 && (byte & 0x40))
                    result |= -(static_cast<int64_t>(1) << shift);
                return result;
            }
        }
        return std::unexpected(make_error_code(ReadError::MalformedLEB128));
    }

    // -----------------------------------------------------------------------
    // Null-terminated string read (bounded by section end)
    // -----------------------------------------------------------------------
    [[nodiscard]] ReadResult<std::string_view> read_cstring() noexcept {
        const size_t start = cursor_;
        while (cursor_ < data_.size()) {
            if (data_[cursor_] == 0) {
                std::string_view sv(
                    reinterpret_cast<const char*>(data_.data() + start),
                    cursor_ - start);
                ++cursor_; // consume null terminator
                return sv;
            }
            ++cursor_;
        }
        // Reached end without null terminator
        return std::unexpected(make_error_code(ReadError::InvalidString));
    }

    // Read string from a string table at a fixed offset (non-destructive)
    [[nodiscard]] ReadResult<std::string_view>
    read_cstring_at(size_t offset) const noexcept {
        if (offset >= data_.size())
            return std::unexpected(make_error_code(ReadError::OutOfBounds));
        const size_t start = offset;
        size_t pos = offset;
        while (pos < data_.size()) {
            if (data_[pos] == 0) {
                return std::string_view(
                    reinterpret_cast<const char*>(data_.data() + start),
                    pos - start);
            }
            ++pos;
        }
        return std::unexpected(make_error_code(ReadError::InvalidString));
    }

    // Read exactly n bytes as a sub-span
    [[nodiscard]] ReadResult<std::span<const uint8_t>> read_bytes(size_t n) noexcept {
        if (n > remaining())
            return std::unexpected(make_error_code(ReadError::OutOfBounds));
        auto sub = data_.subspan(cursor_, n);
        cursor_ += n;
        return sub;
    }

    // Sub-reader over a section [offset, offset+size)
    [[nodiscard]] ReadResult<SpanReader>
    sub_reader(size_t offset, size_t size) const noexcept {
        if (offset + size > data_.size() || offset + size < offset)
            return std::unexpected(make_error_code(ReadError::OutOfBounds));
        return SpanReader(data_.subspan(offset, size));
    }

    // Access underlying span
    [[nodiscard]] std::span<const uint8_t> data() const noexcept { return data_; }

private:
    std::span<const uint8_t> data_;
    size_t cursor_;
};

} // namespace dwarflens
