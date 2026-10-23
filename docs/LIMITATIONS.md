# DwarfLens — Engineering Limitations & Architecture Trade-offs

DwarfLens prioritizes zero-dependency portability, deterministic execution, and fast client-side analysis. This document explicitly outlines known technical constraints, platform boundaries, and architectural design choices.

---

## 1. 📐 Cache-Line Straddle Alignment Assumptions

### The Assumption
DwarfLens evaluates CPU cache-line crossings ($\lfloor \text{offset}/64 \rfloor \neq \lfloor (\text{offset} + \text{size} - 1)/64 \rfloor$) assuming that the struct instance begins at a **64-byte aligned base address** (`offset ≡ 0 (mod 64)`). This matches the convention adopted by tools like `pahole`.

### The Reality
If a struct's natural alignment is less than 64 bytes (`alignof(T) < 64`, e.g. 4 or 8 bytes), instances allocated on the heap or in contiguous arrays may start at any address that is a multiple of their alignment. Consequently:
- A field that does not cross a 64-byte boundary at offset 0 **can straddle a cache boundary** if placed at offset 8, 16, or 56.
- To provide full transparency, DwarfLens reports two metrics for every struct:
  1. `min_cache_lines_touched`: The number of 64-byte cache lines spanned when the struct base is 64-byte aligned ($\lceil \text{byte\_size}/64 \rceil$).
  2. `max_cache_lines_touched`: The worst-case number of cache lines touched when placed at an arbitrary valid alignment boundary $\text{align} < 64$ ($\lceil (\text{byte\_size} + 64 - \text{align})/64 \rceil$).

---

## 2. ⚠️ Repacker Safety & ABI Constraints

### "Size-Optimal" vs. "Hot/Cold" Grouping
The repacker engine sorts non-base members strictly by **descending alignment** (8-byte $\to$ 4-byte $\to$ 2-byte $\to$ 1-byte).
- **Size-Optimal:** This algorithm is mathematically optimal for minimizing internal padding holes and total instance size under standard platform ABIs.
- **Not Access-Optimal:** Minimizing size does **not** group fields accessed together within the same loop or thread onto the same cache line. In performance-critical multithreaded systems, grouping "hot" fields together or separating variables to prevent false sharing takes precedence over packing efficiency.

### ABI Breaking Changes
Reordering struct fields changes the binary layout of the type.
- **NEVER** apply field reordering to:
  1. Structs exposed in public library headers / shared library C ABIs.
  2. Structs serialized directly to disk or network (e.g. `memcpy`, socket buffers, flat buffers).
  3. Structs mapped to hardware registers or memory-mapped files (`mmap`).
- DwarfLens automatically emits clear safety warnings on all generated C++ and Rust code suggestions.

---

## 3. 🗜️ Compressed DWARF Sections (`SHF_COMPRESSED` / `.zdebug`)

Compilers can compress debug sections using `-gz` (using zlib or zstd compression).
- In ELF, this sets the `SHF_COMPRESSED` (0x800) flag and prefixes sections with an `Elf64_Chdr` header.
- **Zero-Dependency Trade-off:** Bundling zlib, miniz, or zstd would violate the strict zero-dependency core requirement.
- **Workaround:** Compile binaries for profiling with `-gz=none`, or decompress existing binaries before analysis using:
  ```bash
  objcopy --decompress-debug-sections my_binary my_binary_decompressed
  ```

---

## 4. 🍎 Platform Debug Format Limits

| Platform | Executable Format | DwarfLens Footprint & Symbol Analysis | DwarfLens Struct Layout Extraction | Notes |
| :--- | :--- | :---: | :---: | :--- |
| **Linux** | ELF64 | ✅ Supported | ✅ Full DWARF v4/v5 | Standard embedded DWARF. |
| **WebAssembly** | Wasm | ✅ Supported | ⚠️ Symbols only | Wasm binaries do not contain DWARF DIE tables unless compiled with `-gwasm`. |
| **macOS** | Mach-O 64-bit | ✅ Supported | ⚠️ Object files / `.dSYM` | Apple's linker (`ld64`/`ld-prime`) strips DWARF from final binaries. DWARF remains in `.o` files or separate `.dSYM` bundles generated via `dsymutil`. |
| **Windows** | PE/COFF | ✅ Supported | ⚠️ MinGW/GCC only | MSVC emits proprietary `.pdb` (CodeView) files, which are not DWARF. DWARF extraction on PE works when compiling via GCC/Clang on Windows (MinGW-w64). |

---

## 5. 🌐 WebAssembly Browser 256 MB Memory Shield

The interactive Web App runs 100% client-side via WebAssembly compiled with Emscripten.
- Browsers enforce memory allocation ceilings on 32-bit WebAssembly linear memory heaps (`wasm32`).
- To prevent browser tab crashes on massive binaries (e.g. 1GB+ debug builds of Chromium or LLVM), the web client enforces a 256 MB safety shield directing users to the native zero-copy CLI (`dwarflens analyze`).
