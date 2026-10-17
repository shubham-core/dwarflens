// SPDX-License-Identifier: MIT
// DwarfLens — src/wasmLoader.ts
// Module that attempts to load the DwarfLens WebAssembly engine or falls back gracefully.

export interface DwarfLensWasm {
  analyzeBinary(data: Uint8Array, filename: string): string; // returns JSON
  diffBinaries(base: Uint8Array, baseName: string, target: Uint8Array, targetName: string): string;
}

interface EmscriptenModule {
  _malloc(bytes: number): number;
  _free(ptr: number): void;
  HEAPU8: Uint8Array;
  UTF8ToString?(ptr: number): string;
  stringToUTF8?(str: string, outPtr: number, maxBytesToWrite: number): void;
  lengthBytesUTF8?(str: string): number;
  ccall?(ident: string, returnType: string | null, argTypes: string[], args: unknown[]): unknown;
  _analyzeBinary?(dataPtr: number, size: number, filenamePtr: number): number;
  _diffBinaries?(basePtr: number, baseSize: number, baseNamePtr: number, targetPtr: number, targetSize: number, targetNamePtr: number): number;
  _dwarflensVersion?(): number;
}

/**
 * UTF-8 string decoding fallback if Emscripten's UTF8ToString is unavailable.
 */
function decodeUtf8(heap: Uint8Array, ptr: number): string {
  let end = ptr;
  while (heap[end] !== 0) {
    end++;
  }
  const slice = heap.subarray(ptr, end);
  return new TextDecoder('utf-8').decode(slice);
}

/**
 * Encodes a string into Emscripten heap, returning pointer.
 */
function allocateString(mod: EmscriptenModule, str: string): number {
  if (mod.stringToUTF8 && mod.lengthBytesUTF8) {
    const len = mod.lengthBytesUTF8(str) + 1;
    const ptr = mod._malloc(len);
    mod.stringToUTF8(str, ptr, len);
    return ptr;
  }
  const encoder = new TextEncoder();
  const bytes = encoder.encode(str + '\0');
  const ptr = mod._malloc(bytes.length);
  mod.HEAPU8.set(bytes, ptr);
  return ptr;
}

/**
 * Wrap raw Emscripten module into DwarfLensWasm interface.
 */
function wrapModule(mod: EmscriptenModule): DwarfLensWasm {
  return {
    analyzeBinary(data: Uint8Array, filename: string): string {
      const dataPtr = mod._malloc(data.length);
      mod.HEAPU8.set(data, dataPtr);
      const namePtr = allocateString(mod, filename);

      let resPtr = 0;
      try {
        if (typeof mod.ccall === 'function') {
          resPtr = mod.ccall(
            'analyzeBinary',
            'number',
            ['number', 'number', 'number'],
            [dataPtr, data.length, namePtr]
          ) as number;
        } else if (typeof mod._analyzeBinary === 'function') {
          resPtr = mod._analyzeBinary(dataPtr, data.length, namePtr);
        } else {
          throw new Error('analyzeBinary function export not found in Wasm module');
        }

        const jsonStr = mod.UTF8ToString
          ? mod.UTF8ToString(resPtr)
          : decodeUtf8(mod.HEAPU8, resPtr);

        return jsonStr;
      } finally {
        mod._free(dataPtr);
        mod._free(namePtr);
        if (resPtr) {
          mod._free(resPtr);
        }
      }
    },

    diffBinaries(base: Uint8Array, baseName: string, target: Uint8Array, targetName: string): string {
      const basePtr = mod._malloc(base.length);
      mod.HEAPU8.set(base, basePtr);
      const baseNamePtr = allocateString(mod, baseName);

      const targetPtr = mod._malloc(target.length);
      mod.HEAPU8.set(target, targetPtr);
      const targetNamePtr = allocateString(mod, targetName);

      let resPtr = 0;
      try {
        if (typeof mod.ccall === 'function') {
          resPtr = mod.ccall(
            'diffBinaries',
            'number',
            ['number', 'number', 'number', 'number', 'number', 'number'],
            [basePtr, base.length, baseNamePtr, targetPtr, target.length, targetNamePtr]
          ) as number;
        } else if (typeof mod._diffBinaries === 'function') {
          resPtr = mod._diffBinaries(basePtr, base.length, baseNamePtr, targetPtr, target.length, targetNamePtr);
        } else {
          throw new Error('diffBinaries function export not found in Wasm module');
        }

        const jsonStr = mod.UTF8ToString
          ? mod.UTF8ToString(resPtr)
          : decodeUtf8(mod.HEAPU8, resPtr);

        return jsonStr;
      } finally {
        mod._free(basePtr);
        mod._free(baseNamePtr);
        mod._free(targetPtr);
        mod._free(targetNamePtr);
        if (resPtr) {
          mod._free(resPtr);
        }
      }
    },
  };
}

/**
 * Attempts to load the DwarfLens Wasm module. Returns null gracefully if unavailable.
 */
export async function loadWasmModule(): Promise<DwarfLensWasm | null> {
  try {
    // 1. Check if window has pre-instantiated DwarfLens module factory
    const globalObj = typeof window !== 'undefined' ? (window as unknown as Record<string, unknown>) : null;
    if (globalObj) {
      if (typeof globalObj.DwarfLensModule === 'function') {
        const factory = globalObj.DwarfLensModule as (opts?: unknown) => Promise<EmscriptenModule>;
        const mod = await factory();
        return wrapModule(mod);
      }
      if (typeof globalObj.createDwarfLensModule === 'function') {
        const factory = globalObj.createDwarfLensModule as (opts?: unknown) => Promise<EmscriptenModule>;
        const mod = await factory();
        return wrapModule(mod);
      }
    }

    // 2. Try dynamic import from standard web paths if served
    const potentialPaths = ['/wasm/dwarflens.js', './wasm/dwarflens.js', '/dwarflens.js'];
    for (const path of potentialPaths) {
      try {
        // Use variable import to prevent Vite from bundling a non-existent static file at build time
        const imported = await import(/* @vite-ignore */ path);
        const factory = imported.default || imported.DwarfLensModule || imported;
        if (typeof factory === 'function') {
          const mod = await factory();
          return wrapModule(mod);
        }
      } catch {
        // Expected if file doesn't exist yet
      }
    }

    return null;
  } catch (err) {
    console.warn('[DwarfLens] Wasm engine not loaded, falling back to JSON analysis mode:', err);
    return null;
  }
}
