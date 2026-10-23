# Compiler & Linker Configuration Guide for DwarfLens

This guide outlines compiler debug flags, Link-Time Optimization (LTO) considerations, and runtime settings to maximize layout and size analysis accuracy with DwarfLens.

---

## 🔧 Compiler Debug Flags (`-g` vs `-g1` vs `-g3`)

The quality and completeness of DWARF struct layout extraction depends directly on the compiler's debug generation level:

| Flag | Debug Level | Struct Layout Extraction | Section Size Attribution | Notes |
| :--- | :--- | :---: | :---: | :--- |
| **`-g0` / stripped** | None | ❌ No | ⚠️ Sections & Exported Symbols Only | Strips `.debug_*` sections. |
| **`-g1`** | Line tables only | ❌ No | ✅ Full | Emits line numbers for backtraces, but omits `DW_TAG_structure_type` and `DW_TAG_member` DIEs. |
| **`-g` / `-g2`** | Standard DWARF | ✅ Full (Optimal) | ✅ Full | Recommended. Emits complete type, field, offset, and alignment metadata. |
| **`-g3`** | DWARF + Macro Tables | ✅ Full | ✅ Full | Includes `.debug_macro` / `.debug_macinfo`. Struct layouts identical to `-g2`, but binary is larger. |

---

## ⚙️ GCC vs. Clang Considerations

### 1. GCC Type Pruning (`-feliminate-unused-debug-types`)
By default in optimized builds (`-O2`), GCC prunes unreferenced struct declarations from debug tables. If a struct is declared in a header but never instantiated or accessed by compiled code, GCC omits its DIE.

To force GCC to emit DWARF records for all declared types in a library or test fixture:
```bash
g++ -g -O2 -fno-eliminate-unused-debug-types my_app.cpp -o my_app
```

### 2. Clang Standalone Debug (`-fstandalone-debug`)
To minimize object file size, Clang often emits forward declarations (`DW_AT_declaration = 1`) instead of complete type definitions if the constructor or vtable is defined in an external compilation unit.

To force Clang to emit complete type layout records in all compilation units:
```bash
clang++ -g -O2 -fstandalone-debug my_app.cpp -o my_app
```

---

## ⚡ Link-Time Optimization (LTO) Handling

When Link-Time Optimization (`-flto` with GCC/Clang or `-fuse-ld=lld / -flto=thin`) is enabled, linkers inline functions across compilation units and reorder code:

1. **Non-Contiguous Section Splitting:**
   Compilers fragment symbols across `.text.hot`, `.text.unlikely`, `.text.startup`, and `.text.exit`. DwarfLens uses interval trees (`RangeMap`) to attribute disjoint address intervals to the appropriate symbols without double-counting bytes.

2. **Cross-Compilation Unit Type Deduplication (`DW_FORM_ref_addr`):**
   Linkers deduplicate identical types across translation units using `DW_FORM_ref_addr` (cross-CU global offset references) rather than local unit offsets (`DW_FORM_ref4`). DwarfLens's two-pass DIE walker tracks absolute `.debug_info` offsets to resolve names, sizes, and alignments seamlessly across CU boundaries.

3. **Dead-Code Elimination:**
   Unused struct members and virtual methods eliminated by whole-program optimization are accurately reflected: DwarfLens only reports layouts for structures that survive code generation into the final executable.
