// SPDX-License-Identifier: MIT
// DwarfLens — src/types.ts
// TypeScript interfaces matching the JSON output from DwarfLens C++ core

export interface StructMember {
  name: string;
  type_name: string;
  offset: number;
  byte_size: number;
  alignment: number;
  is_bitfield: boolean;
  is_base_class: boolean;
}

export interface PaddingHole {
  offset: number;
  size: number;
  before: string;
  after: string;
}

export interface CacheLineCrossing {
  member_name: string;
  member_offset: number;
  member_size: number;
  boundary: number;
}

export interface OptimalLayout {
  byte_size: number;
  bytes_saved: number;
  cpp_snippet: string;
  rust_snippet: string;
}

export interface StructLayout {
  name: string;
  tag: string;
  source_file: string;
  source_line: number;
  byte_size: number;
  alignment: number;
  total_padding_bytes: number;
  useful_bytes: number;
  cache_lines_spanned: number;
  has_padding: boolean;
  has_cache_line_crossing: boolean;
  members: StructMember[];
  padding_holes: PaddingHole[];
  cache_line_crossings: CacheLineCrossing[];
  optimal: OptimalLayout | null;
}

export interface SectionSummary {
  name: string;
  category: string;
  size: number;
  vm_addr: number;
}

export interface SymbolSummary {
  name: string;
  raw_name: string;
  section: string;
  compile_unit: string;
  template_group: string;
  size: number;
  type: string;
}

export interface BinaryAnalysis {
  filename: string;
  file_size: number;
  format: 'ELF' | 'Wasm';
  flash_size: number;
  ram_size: number;
  sections: SectionSummary[];
  symbols: SymbolSummary[];
  structs: StructLayout[];
}

export interface SectionDelta {
  name: string;
  base_size: number;
  target_size: number;
  delta_bytes: number;
  delta_pct: number;
  change: string;
}

export interface SymbolDelta {
  name: string;
  section: string;
  template_group: string;
  base_size: number;
  target_size: number;
  delta_bytes: number;
  change: string;
}

export interface StructRegression {
  name: string;
  size_delta: number;
  padding_delta: number;
  cache_line_delta: number;
  is_regression: boolean;
}

export interface DiffResult {
  base_filename: string;
  target_filename: string;
  file_size_delta: number;
  flash_delta: number;
  ram_delta: number;
  file_size_pct: number;
  flash_pct: number;
  ram_pct: number;
  exceeded_growth_threshold: boolean;
  has_padding_regression: boolean;
  section_deltas: SectionDelta[];
  symbol_deltas: SymbolDelta[];
  struct_regressions: StructRegression[];
}

export interface DiffPayload {
  diff: DiffResult;
  base?: BinaryAnalysis;
  target?: BinaryAnalysis;
}

export type AppState = 'idle' | 'loading' | 'analyze' | 'diff';
export type ActiveTab = 'overview' | 'symbols' | 'structs' | 'xray';
export type NavTab = 'analyze' | 'diff' | 'structs' | 'about';
