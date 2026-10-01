// SPDX-License-Identifier: MIT
// DwarfLens — tests/fixtures/sample_target.cpp
// Deliberately padded structs and functions for DWARF extraction testing.
// Compile with: g++ -g -O0 -o sample_target sample_target.cpp
// Compile bloated with: g++ -g -O0 -DBLOAT -o sample_target_bloat sample_target.cpp

#include <cstdint>
#include <cstddef>

// ============================================================
// Structs with deliberate padding — DwarfLens should detect these
// ============================================================

// char(1) + pad(7) + double(8) + char(1) + pad(3) + int(4) = 24 bytes total
// Optimal: double(8) + int(4) + char(1) + char(1) + pad(2) = 16 bytes
struct BadLayout {
    char   a;       // +0,  size=1
    // [padding: 7 bytes at +1]
    double b;       // +8,  size=8
    char   c;       // +16, size=1
    // [padding: 3 bytes at +17]
    int    d;       // +20, size=4
};
// sizeof(BadLayout) should be 24
static_assert(sizeof(BadLayout) == 24, "BadLayout expected 24 bytes");
static_assert(offsetof(BadLayout, a) == 0);
static_assert(offsetof(BadLayout, b) == 8);
static_assert(offsetof(BadLayout, c) == 16);
static_assert(offsetof(BadLayout, d) == 20);

// A struct that crosses a 64-byte cache line.
// header[56] = bytes 0-55 (fits in cache line 0: 0-63)
// crossing_val at offset 56, size 8: bytes 56-63 stay in line 0 — no crossing!
// To guarantee crossing: put 8-byte value starting at byte 60 (but compiler pads to 64).
// Use packed attribute or manual layout. Let's use a simple verifiable design:
// - 4 uint64_t (32 bytes) + uint8_t[32] (32 bytes) = 64 bytes (fits 1 cache line)
// - Add a straddling member: offset=60, size=8 (if header is 60 bytes of char)
// The actual layout: header[60] at +0 (60 bytes), then 4 bytes pad, crossing_val at +64
// So crossing_val starts exactly at cache-line boundary — touching but not crossing.
// Better: use __attribute__((packed)) to force crossing.
struct CacheLineSplitter {
    uint8_t  header[60];    // bytes 0-59
    uint32_t gap;           // bytes 60-63 (fills to cache line boundary)  
    uint64_t crossing_val;  // bytes 64-71 (starts at boundary, does NOT cross)
    uint32_t trailer;       // bytes 72-75
    // padded to 80 bytes for sizeof
};
static_assert(sizeof(CacheLineSplitter) == 80);

// This struct truly crosses a cache-line boundary via its member:
// crossing_val starts at byte 56 in a packed struct
#pragma pack(1)
struct CacheLineSplitterPacked {
    uint8_t  header[56];    // bytes 0-55
    uint64_t crossing_val;  // bytes 56-63: starts in line 0, ends JUST at boundary
    uint64_t crossing_val2; // bytes 64-71: starts at line 1, ok
    // But to truly CROSS: need member spanning [56, 64) — i.e. offset 56, size > 8
    // Or: 60 bytes header + uint64_t at byte 60 (crosses line at 64)
};
#pragma pack()
// For test purposes, use a simple unpacked struct that definitely crosses:
// member at offset=60 with size=8 means bytes [60..67] which crosses 64-byte boundary
// We achieve this by using attributes:
struct __attribute__((packed)) CrossingStruct {
    uint8_t  header[60];    // bytes 0-59
    uint64_t crossing_val;  // bytes 60-67: crosses 64-byte boundary! 60/64=0, 67/64=1
    uint32_t trailer;       // bytes 68-71
};

// A well-packed struct — DwarfLens should report 0 padding
struct GoodLayout {
    double  x;     // +0,  size=8
    int64_t y;     // +8,  size=8
    int32_t z;     // +16, size=4
    int16_t w;     // +20, size=2
    int8_t  v;     // +22, size=1
    int8_t  u;     // +23, size=1
};
static_assert(sizeof(GoodLayout) == 24);
static_assert(offsetof(GoodLayout, x) == 0);
static_assert(offsetof(GoodLayout, y) == 8);

// A struct with tail padding
struct TailPad {
    int64_t big;   // +0, size=8
    int8_t  small; // +8, size=1
    // [tail padding: 7 bytes at +9]
};
static_assert(sizeof(TailPad) == 16);

#ifdef BLOAT
// Extra struct for the "target" binary — regression testing
struct BloatedLayout {
    char     a;
    // padding 7
    double   b;
    char     c;
    // padding 3
    int      d;
    char     e;
    // padding 7
    uint64_t f;    // extra 8-byte field added in this version
};
static_assert(sizeof(BloatedLayout) >= 32); // got bigger!

// Extra function for symbol delta testing
static void extra_function_added_in_target() {
    volatile int x = 0;
    for (int i = 0; i < 100; ++i) x += i;
    (void)x;
}
#endif

// ============================================================
// Functions for symbol size testing
// ============================================================

__attribute__((noinline)) int compute_sum(int n) {
    int sum = 0;
    for (int i = 0; i < n; ++i) sum += i;
    return sum;
}

__attribute__((noinline)) double compute_product(double x, int n) {
    double prod = 1.0;
    for (int i = 1; i <= n; ++i) prod *= (x + i);
    return prod;
}

// Template instantiations (to test template grouping)
template<typename T>
__attribute__((noinline)) T identity(T val) { return val; }

template int    identity<int>(int);
template double identity<double>(double);
template float  identity<float>(float);

int main() {
    BadLayout bl{};
    bl.a = 'A'; bl.b = 3.14; bl.c = 'C'; bl.d = 42;

    CacheLineSplitter cls{};
    cls.crossing_val = 0xDEADBEEF;

    GoodLayout gl{};
    gl.x = 1.0; gl.y = 2; gl.z = 3; gl.w = 4; gl.v = 5; gl.u = 6;

    TailPad tp{}; tp.big = 999; tp.small = 1;

    volatile int r = compute_sum(100);
    volatile double p = compute_product(1.5, 5);
    volatile int i1 = identity<int>(42);
    volatile double d1 = identity<double>(3.14);
    volatile float f1 = identity<float>(1.0f);

    CrossingStruct cs{};
    cs.crossing_val = 0xCAFE;

    (void)bl; (void)cls; (void)gl; (void)tp; (void)cs;
    (void)r; (void)p; (void)i1; (void)d1; (void)f1;

#ifdef BLOAT
    BloatedLayout bll{};
    extra_function_added_in_target();
    (void)bll;
#endif

    return 0;
}
