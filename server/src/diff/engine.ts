export interface SectionSummary {
  name: string;
  category: string;
  size: number;
}

export interface SymbolSummary {
  name: string;
  size: number;
  section?: string;
  type?: string;
}

export interface StructSummary {
  name: string;
  byte_size: number;
  alignment: number;
  total_padding_bytes: number;
  cache_lines_spanned: number;
  has_padding: boolean;
  has_cache_line_crossing: boolean;
}

export interface SectionDelta {
  name: string;
  category: string;
  base_size: number;
  head_size: number;
  delta: number;
  pct_change: number;
}

export interface SymbolDelta {
  name: string;
  base_size: number;
  head_size: number;
  delta: number;
  status: 'added' | 'removed' | 'modified' | 'unchanged';
}

export interface StructRegression {
  name: string;
  base_padding: number;
  head_padding: number;
  padding_delta: number;
  base_cache_lines: number;
  head_cache_lines: number;
  cache_lines_delta: number;
  has_regression: boolean;
}

export interface AnalysisDiffResult {
  base_commit: string;
  head_commit: string;
  base_file_size: number;
  head_file_size: number;
  file_size_delta: number;
  file_size_pct: number;
  flash_delta: number;
  ram_delta: number;
  has_padding_regression: boolean;
  section_deltas: SectionDelta[];
  top_symbol_deltas: SymbolDelta[];
  struct_regressions: StructRegression[];
}

export function computeAnalysisDiff(baseAnalysis: any, headAnalysis: any): AnalysisDiffResult {
  const baseRaw = baseAnalysis.rawData || baseAnalysis;
  const headRaw = headAnalysis.rawData || headAnalysis;

  const baseSize = Number(baseRaw.file_size || 0);
  const headSize = Number(headRaw.file_size || 0);
  const fileSizeDelta = headSize - baseSize;
  const fileSizePct = baseSize > 0 ? (fileSizeDelta / baseSize) * 100 : 0;

  const flashDelta = Number(headRaw.flash_size || 0) - Number(baseRaw.flash_size || 0);
  const ramDelta = Number(headRaw.ram_size || 0) - Number(baseRaw.ram_size || 0);

  // 1. Section Deltas
  const baseSectionsMap = new Map<string, any>();
  for (const s of baseRaw.sections || []) {
    baseSectionsMap.set(s.name, s);
  }

  const headSectionsMap = new Map<string, any>();
  for (const s of headRaw.sections || []) {
    headSectionsMap.set(s.name, s);
  }

  const allSectionNames = new Set([...baseSectionsMap.keys(), ...headSectionsMap.keys()]);
  const sectionDeltas: SectionDelta[] = [];

  for (const name of allSectionNames) {
    const b = baseSectionsMap.get(name);
    const h = headSectionsMap.get(name);
    const bSize = b ? Number(b.size) : 0;
    const hSize = h ? Number(h.size) : 0;
    const delta = hSize - bSize;
    const category = (h || b)?.category || 'other';
    const pct = bSize > 0 ? (delta / bSize) * 100 : (hSize > 0 ? 100 : 0);

    sectionDeltas.push({
      name,
      category,
      base_size: bSize,
      head_size: hSize,
      delta,
      pct_change: Number(pct.toFixed(2)),
    });
  }

  sectionDeltas.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));

  // 2. Top Symbol Deltas
  const baseSymbolsMap = new Map<string, number>();
  for (const s of baseRaw.symbols || []) {
    baseSymbolsMap.set(s.name, Number(s.size || 0));
  }

  const headSymbolsMap = new Map<string, number>();
  for (const s of headRaw.symbols || []) {
    headSymbolsMap.set(s.name, Number(s.size || 0));
  }

  const allSymbolNames = new Set([...baseSymbolsMap.keys(), ...headSymbolsMap.keys()]);
  const symbolDeltas: SymbolDelta[] = [];

  for (const name of allSymbolNames) {
    const hasBase = baseSymbolsMap.has(name);
    const hasHead = headSymbolsMap.has(name);
    const bSize = baseSymbolsMap.get(name) || 0;
    const hSize = headSymbolsMap.get(name) || 0;
    const delta = hSize - bSize;

    if (delta === 0) continue;

    let status: SymbolDelta['status'] = 'modified';
    if (!hasBase && hasHead) status = 'added';
    else if (hasBase && !hasHead) status = 'removed';

    symbolDeltas.push({
      name,
      base_size: bSize,
      head_size: hSize,
      delta,
      status,
    });
  }

  symbolDeltas.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
  const topSymbolDeltas = symbolDeltas.slice(0, 50);

  // 3. Struct padding and cache-line changes
  const baseStructsMap = new Map<string, any>();
  for (const st of baseRaw.structs || []) {
    baseStructsMap.set(st.name, st);
  }

  const headStructsMap = new Map<string, any>();
  for (const st of headRaw.structs || []) {
    headStructsMap.set(st.name, st);
  }

  const allStructNames = new Set([...baseStructsMap.keys(), ...headStructsMap.keys()]);
  const structRegressions: StructRegression[] = [];
  let hasPaddingRegression = false;

  for (const name of allStructNames) {
    const b = baseStructsMap.get(name);
    const h = headStructsMap.get(name);

    const bPad = b ? Number(b.total_padding_bytes || 0) : 0;
    const hPad = h ? Number(h.total_padding_bytes || 0) : 0;
    const padDelta = hPad - bPad;

    const bLines = b ? Number(b.cache_lines_spanned || 0) : 0;
    const hLines = h ? Number(h.cache_lines_spanned || 0) : 0;
    const linesDelta = hLines - bLines;

    const isRegression = padDelta > 0 || (h?.has_cache_line_crossing && !b?.has_cache_line_crossing);
    if (padDelta > 0) hasPaddingRegression = true;

    if (padDelta !== 0 || linesDelta !== 0 || isRegression) {
      structRegressions.push({
        name,
        base_padding: bPad,
        head_padding: hPad,
        padding_delta: padDelta,
        base_cache_lines: bLines,
        head_cache_lines: hLines,
        cache_lines_delta: linesDelta,
        has_regression: isRegression,
      });
    }
  }

  structRegressions.sort((a, b) => b.padding_delta - a.padding_delta);

  return {
    base_commit: baseRaw.metadata?.commit_sha || baseAnalysis.commitSha || 'base',
    head_commit: headRaw.metadata?.commit_sha || headAnalysis.commitSha || 'head',
    base_file_size: baseSize,
    head_file_size: headSize,
    file_size_delta: fileSizeDelta,
    file_size_pct: Number(fileSizePct.toFixed(2)),
    flash_delta: flashDelta,
    ram_delta: ramDelta,
    has_padding_regression: hasPaddingRegression,
    section_deltas: sectionDeltas,
    top_symbol_deltas: topSymbolDeltas,
    struct_regressions: structRegressions,
  };
}
