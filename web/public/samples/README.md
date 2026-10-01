# DwarfLens Pre-generated JSON Samples

These sample JSON files contain pre-generated analysis data produced by the DwarfLens CLI (`dwarflens analyze --json <binary>`) and diff engine (`dwarflens diff --json <base> <target>`).

They allow instantaneous testing and evaluation of the DwarfLens Web frontend without requiring a live WebAssembly compiler or local binary uploads.

## Included Samples

1. **`sample0.json` (Demo: Simple C++)**
   - Simulated embedded ARM Cortex-M ELF binary (`sensor_node_firmware.elf`)
   - Flash size: 84 KB, RAM size: 12 KB
   - Highlights: `SensorPacket` with 20 bytes of wasted alignment padding, showing an optimal layout reorganization saving 16 bytes (33% memory footprint reduction). Includes `NetworkFrameHeader` showing a cache-line crossing at the 64-byte boundary.

2. **`sample1.json` (Demo: STL Heavy)**
   - High-throughput order execution binary (`order_matching_engine.elf`)
   - Flash size: 2.1 MB, RAM size: 480 KB
   - Highlights: Demangled template symbols (`std::vector`, `std::map`, `std::unordered_map`), complex memory layouts spanning multiple 64-byte L1 cache lines with false-sharing and split-cache access risks.

3. **`sample2.json` (Demo: WebAssembly)**
   - WebAssembly module (`image_pipeline.wasm`)
   - Code section size: ~410 KB, Data: 64 KB
   - Highlights: SIMD kernels, exported buffer descriptors with tail padding issues.

4. **`diff_sample.json` (Demo: Binary Diff)**
   - Full diff comparison between `firmware_v1.0.0.elf` and `firmware_v1.1.0.elf`
   - Highlights: Section size deltas, symbol additions/removals/growths, and struct regression flags (+8B padding regression).

## Generating New Samples

To generate new JSON samples using the native DwarfLens CLI tool:

```bash
# Analyze a binary and output JSON:
./build/dwarflens analyze --json /path/to/binary > sample.json

# Diff two binaries:
./build/dwarflens diff --json /path/to/base.elf /path/to/target.elf > diff.json
```
