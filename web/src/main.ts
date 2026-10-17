// SPDX-License-Identifier: MIT
// DwarfLens — src/main.ts
// Complete TypeScript application for DwarfLens Web Frontend

import {
  BinaryAnalysis,
  DiffResult,
  DiffPayload,
  StructLayout,
  AppState,
  ActiveTab,
  NavTab,
} from './types';
import { loadWasmModule, DwarfLensWasm } from './wasmLoader';

// ---------------------------------------------------------------------------
// Global Application State
// ---------------------------------------------------------------------------
export let currentState: AppState = 'idle';
export let currentAnalysis: BinaryAnalysis | null = null;
export let currentDiff: DiffResult | null = null;
export let selectedStruct: StructLayout | null = null;
export let activeResultsTab: ActiveTab = 'overview';
export let activeNavTab: NavTab = 'analyze';
export let wasmEngine: DwarfLensWasm | null = null;

// ---------------------------------------------------------------------------
// Utility Helpers
// ---------------------------------------------------------------------------
function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const sign = bytes < 0 ? '-' : '';
  const abs = Math.abs(bytes);
  if (abs < 1024) return `${sign}${abs} B`;
  if (abs < 1024 * 1024) return `${sign}${(abs / 1024).toFixed(2)} KB`;
  return `${sign}${(abs / (1024 * 1024)).toFixed(2)} MB`;
}

function formatHex(val: number, pad = 2): string {
  return '0x' + val.toString(16).toUpperCase().padStart(pad, '0');
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function getCategoryColor(category: string): string {
  switch (category.toLowerCase()) {
    case 'code':
      return '#58a6ff'; // blue
    case 'rodata':
      return '#3fb950'; // green
    case 'data':
      return '#d29922'; // orange
    case 'bss':
      return '#bc8cff'; // purple
    case 'debug':
      return '#8b949e'; // muted gray
    case 'metadata':
      return '#f778ba'; // pink
    default:
      return '#6e7681'; // dark gray
  }
}

function showAlert(message: string, isError = false): void {
  const banner = document.getElementById('alert-banner');
  const msgEl = document.getElementById('alert-message');
  if (!banner || !msgEl) return;

  msgEl.textContent = message;
  banner.className = `alert ${isError ? 'alert-error' : 'alert-info'}`;
  banner.style.display = 'flex';
}

function hideAlert(): void {
  const banner = document.getElementById('alert-banner');
  if (banner) banner.style.display = 'none';
}

function setState(state: AppState): void {
  currentState = state;
  const loadingEl = document.getElementById('loading-container');
  const resultsEl = document.getElementById('results-section');
  const fileBanner = document.getElementById('file-banner');
  const diffSection = document.getElementById('diff-section');
  const aboutSection = document.getElementById('about-section');

  if (loadingEl) loadingEl.style.display = state === 'loading' ? 'flex' : 'none';

  if (state === 'idle') {
    if (resultsEl) resultsEl.style.display = 'none';
    if (fileBanner) fileBanner.style.display = 'none';
    if (diffSection) diffSection.style.display = 'none';
    if (aboutSection) aboutSection.style.display = 'none';
  } else if (state === 'analyze') {
    if (resultsEl) resultsEl.style.display = 'flex';
    if (fileBanner) fileBanner.style.display = 'flex';
    if (diffSection) diffSection.style.display = 'none';
    if (aboutSection) aboutSection.style.display = 'none';
  } else if (state === 'diff') {
    if (resultsEl) resultsEl.style.display = 'none';
    if (fileBanner) fileBanner.style.display = 'none';
    if (diffSection) diffSection.style.display = 'flex';
    if (aboutSection) aboutSection.style.display = 'none';
  }
}

// ---------------------------------------------------------------------------
// 1. Data Fetching & Sample Loader
// ---------------------------------------------------------------------------
export async function loadSampleData(index: number): Promise<void> {
  try {
    setState('loading');
    hideAlert();
    const loadingText = document.getElementById('loading-text');
    if (loadingText) loadingText.textContent = `Loading demo dataset #${index}...`;

    const res = await fetch(`./samples/sample${index}.json`);
    if (!res.ok) {
      throw new Error(`Failed to load sample: HTTP ${res.status}`);
    }
    const analysis: BinaryAnalysis = await res.json();
    renderAnalysis(analysis);
    setActiveNav('analyze');
  } catch (err) {
    setState('idle');
    showAlert(`Error loading sample: ${(err as Error).message}`, true);
  }
}

export async function loadDiffSample(): Promise<void> {
  try {
    setState('loading');
    hideAlert();
    const res = await fetch(`./samples/diff_sample.json`);
    if (!res.ok) {
      throw new Error(`Failed to load diff sample: HTTP ${res.status}`);
    }
    const diff: DiffResult = await res.json();
    renderDiff(diff);
    setActiveNav('diff');
  } catch (err) {
    setState('idle');
    showAlert(`Error loading diff sample: ${(err as Error).message}`, true);
  }
}

// ---------------------------------------------------------------------------
// 2. Binary File & JSON Drop Handling
// ---------------------------------------------------------------------------
export async function handleFileDrop(file: File): Promise<void> {
  try {
    hideAlert();
    setState('loading');
    const loadingText = document.getElementById('loading-text');

    if (file.name.endsWith('.json')) {
      if (loadingText) loadingText.textContent = `Parsing JSON report: ${file.name}...`;
      const text = await file.text();
      const parsed = JSON.parse(text);

      if (parsed.section_deltas && parsed.symbol_deltas) {
        renderDiff(parsed as DiffResult);
        setActiveNav('diff');
        return;
      }
      if (parsed.diff && parsed.diff.section_deltas) {
        renderDiff((parsed as DiffPayload).diff);
        setActiveNav('diff');
        return;
      }
      if (parsed.sections && parsed.structs) {
        renderAnalysis(parsed as BinaryAnalysis);
        setActiveNav('analyze');
        return;
      }
      throw new Error('Unrecognized JSON schema. Expected DwarfLens analysis or diff report.');
    }

    // Binary file (ELF or Wasm)
    if (loadingText) loadingText.textContent = `Reading binary file: ${file.name} (${formatBytes(file.size)})...`;
    const buffer = await file.arrayBuffer();
    const uint8Array = new Uint8Array(buffer);

    if (wasmEngine) {
      if (loadingText) loadingText.textContent = `Executing DwarfLens WebAssembly engine on ${file.name}...`;
      const jsonStr = wasmEngine.analyzeBinary(uint8Array, file.name);
      const parsed = JSON.parse(jsonStr);
      if (parsed.error) {
        throw new Error(parsed.error);
      }
      renderAnalysis(parsed as BinaryAnalysis);
      setActiveNav('analyze');
    } else {
      setState('idle');
      showAlert(
        `Wasm module not loaded. To inspect raw binary "${file.name}", use the native CLI:\n` +
        `./build/dwarflens analyze --json "${file.name}" > report.json\n` +
        `then drop report.json here, or select a preloaded demo above.`,
        true
      );
    }
  } catch (err) {
    setState('idle');
    showAlert(`Failed to process file: ${(err as Error).message}`, true);
  }
}

// ---------------------------------------------------------------------------
// 3. Rendering Analysis (Overview, Symbols, Structs)
// ---------------------------------------------------------------------------
export function renderAnalysis(analysis: BinaryAnalysis): void {
  currentAnalysis = analysis;
  setState('analyze');

  // Populate Header Banner
  const formatEl = document.getElementById('banner-format');
  const filenameEl = document.getElementById('banner-filename');
  const filesizeEl = document.getElementById('banner-filesize');
  const flashEl = document.getElementById('banner-flash');
  const ramEl = document.getElementById('banner-ram');
  const structCountEl = document.getElementById('banner-structs-count');

  if (formatEl) formatEl.textContent = analysis.format;
  if (filenameEl) filenameEl.textContent = analysis.filename;
  if (filesizeEl) filesizeEl.textContent = formatBytes(analysis.file_size);
  if (flashEl) flashEl.textContent = formatBytes(analysis.flash_size);
  if (ramEl) ramEl.textContent = formatBytes(analysis.ram_size);
  if (structCountEl) structCountEl.textContent = analysis.structs.length.toString();

  // Overview Metrics Cards
  const mFlash = document.getElementById('metric-flash');
  const mRam = document.getElementById('metric-ram');
  const mPadding = document.getElementById('metric-padding');
  const mPaddingSub = document.getElementById('metric-padding-sub');
  const mCrossings = document.getElementById('metric-crossings');

  if (mFlash) mFlash.textContent = formatBytes(analysis.flash_size);
  if (mRam) mRam.textContent = formatBytes(analysis.ram_size);

  const totalPadding = analysis.structs.reduce((acc, s) => acc + s.total_padding_bytes, 0);
  const totalStructBytes = analysis.structs.reduce((acc, s) => acc + s.byte_size, 0);
  const paddingPct = totalStructBytes > 0 ? ((totalPadding / totalStructBytes) * 100).toFixed(1) : '0';
  const totalCrossings = analysis.structs.reduce((acc, s) => acc + s.cache_line_crossings.length, 0);

  if (mPadding) mPadding.textContent = formatBytes(totalPadding);
  if (mPaddingSub) mPaddingSub.textContent = `${paddingPct}% of struct memory wasted in padding holes`;
  if (mCrossings) mCrossings.textContent = totalCrossings.toString();

  // Proportional Section Bar
  renderSectionBar(analysis);

  // Sections Table
  renderSectionsTable(analysis);

  // Symbols Table
  renderSymbolsTable(analysis);

  // Structs Table
  renderStructsTable(analysis);

  // Cache-Line X-Ray Select Dropdown & First Struct
  populateStructSelector(analysis);

  // Default to overview tab
  setActiveTab(activeResultsTab);
}

// Render Proportional Section Visual Bar
function renderSectionBar(analysis: BinaryAnalysis): void {
  const bar = document.getElementById('section-proportional-bar');
  const legend = document.getElementById('section-legend');
  const totalLabel = document.getElementById('section-bar-total-size');
  if (!bar || !legend) return;

  bar.innerHTML = '';
  legend.innerHTML = '';

  const totalBytes = analysis.sections.reduce((acc, s) => acc + s.size, 0);
  if (totalLabel) totalLabel.textContent = `Total Sections: ${formatBytes(totalBytes)}`;

  const categoryTotals: Record<string, number> = {};

  for (const s of analysis.sections) {
    if (s.size <= 0) continue;
    const cat = s.category.toLowerCase();
    categoryTotals[cat] = (categoryTotals[cat] || 0) + s.size;

    const pct = (s.size / totalBytes) * 100;
    const seg = document.createElement('div');
    seg.className = 'section-segment';
    seg.style.width = `${pct}%`;
    seg.style.backgroundColor = getCategoryColor(s.category);
    seg.title = `${s.name} (${s.category}): ${formatBytes(s.size)} (${pct.toFixed(1)}%)`;
    bar.appendChild(seg);
  }

  // Legend
  for (const [cat, size] of Object.entries(categoryTotals)) {
    const item = document.createElement('div');
    item.className = 'legend-item';
    const colorBox = document.createElement('span');
    colorBox.className = 'legend-color';
    colorBox.style.backgroundColor = getCategoryColor(cat);

    const label = document.createElement('span');
    label.textContent = `${cat.toUpperCase()}: ${formatBytes(size)} (${((size / totalBytes) * 100).toFixed(1)}%)`;

    item.appendChild(colorBox);
    item.appendChild(label);
    legend.appendChild(item);
  }
}

// Render Sections Table
function renderSectionsTable(analysis: BinaryAnalysis): void {
  const tbody = document.getElementById('sections-tbody');
  if (!tbody) return;
  tbody.innerHTML = '';

  const totalBytes = analysis.sections.reduce((acc, s) => acc + s.size, 0);

  for (const s of analysis.sections) {
    const tr = document.createElement('tr');
    const pct = totalBytes > 0 ? ((s.size / totalBytes) * 100).toFixed(1) : '0';

    tr.innerHTML = `
      <td class="mono" style="font-weight: 600;">${escapeHtml(s.name)}</td>
      <td><span class="badge" style="background: ${getCategoryColor(s.category)}22; color: ${getCategoryColor(s.category)}; border: 1px solid ${getCategoryColor(s.category)}44;">${escapeHtml(s.category)}</span></td>
      <td class="mono">${formatBytes(s.size)} (${s.size.toLocaleString()} B)</td>
      <td class="mono">${s.vm_addr > 0 ? formatHex(s.vm_addr, 8) : '—'}</td>
      <td class="mono">${pct}%</td>
    `;
    tbody.appendChild(tr);
  }
}

// Render Symbols Table with Filtering & Sorting
function renderSymbolsTable(analysis: BinaryAnalysis): void {
  const tbody = document.getElementById('symbols-tbody');
  const countEl = document.getElementById('symbols-count');
  const searchInput = document.getElementById('symbol-search') as HTMLInputElement | null;
  const typeFilter = document.getElementById('symbol-type-filter') as HTMLSelectElement | null;
  const sortSelect = document.getElementById('symbol-sort') as HTMLSelectElement | null;
  if (!tbody) return;

  const query = searchInput ? searchInput.value.toLowerCase().trim() : '';
  const typeVal = typeFilter ? typeFilter.value : 'all';
  const sortVal = sortSelect ? sortSelect.value : 'size-desc';

  let filtered = analysis.symbols.filter((sym) => {
    if (typeVal !== 'all' && sym.type !== typeVal) return false;
    if (query) {
      return (
        sym.name.toLowerCase().includes(query) ||
        sym.raw_name.toLowerCase().includes(query) ||
        sym.compile_unit.toLowerCase().includes(query)
      );
    }
    return true;
  });

  if (sortVal === 'size-desc') {
    filtered.sort((a, b) => b.size - a.size);
  } else if (sortVal === 'size-asc') {
    filtered.sort((a, b) => a.size - b.size);
  } else if (sortVal === 'name-asc') {
    filtered.sort((a, b) => a.name.localeCompare(b.name));
  }

  const top100 = filtered.slice(0, 100);
  if (countEl) countEl.textContent = `Showing top ${top100.length} of ${filtered.length} matching symbols`;

  tbody.innerHTML = '';
  const maxSize = top100.length > 0 ? Math.max(...top100.map((s) => s.size)) : 1;

  for (const sym of top100) {
    const tr = document.createElement('tr');
    const barWidth = Math.max(4, Math.round((sym.size / maxSize) * 100));

    tr.innerHTML = `
      <td>
        <div class="mono" style="font-weight: 600; color: #fff;" title="${escapeHtml(sym.raw_name)}">${escapeHtml(sym.name)}</div>
        ${sym.template_group ? `<div style="font-size: 0.72rem; color: var(--accent);">Template: ${escapeHtml(sym.template_group)}</div>` : ''}
      </td>
      <td><span class="badge badge-code">${escapeHtml(sym.section)}</span></td>
      <td><span class="badge" style="background: var(--bg-card); color: var(--text-secondary);">${escapeHtml(sym.type)}</span></td>
      <td style="font-size: 0.78rem; color: var(--text-secondary); max-width: 250px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${escapeHtml(sym.compile_unit || '—')}</td>
      <td class="mono" style="white-space: nowrap;">
        <div>${formatBytes(sym.size)}</div>
        <div style="background: var(--bg-tertiary); height: 4px; width: 80px; border-radius: 2px; margin-top: 3px; overflow: hidden;">
          <div style="background: var(--accent); height: 100%; width: ${barWidth}%;"></div>
        </div>
      </td>
    `;
    tbody.appendChild(tr);
  }
}

// Render Structs Table
function renderStructsTable(analysis: BinaryAnalysis): void {
  const tbody = document.getElementById('structs-tbody');
  const countEl = document.getElementById('structs-count');
  const searchInput = document.getElementById('struct-search') as HTMLInputElement | null;
  const paddingOnly = document.getElementById('struct-filter-padding') as HTMLInputElement | null;
  const crossingOnly = document.getElementById('struct-filter-crossing') as HTMLInputElement | null;
  if (!tbody) return;

  const query = searchInput ? searchInput.value.toLowerCase().trim() : '';
  const filterPadding = paddingOnly ? paddingOnly.checked : false;
  const filterCrossing = crossingOnly ? crossingOnly.checked : false;

  const filtered = analysis.structs.filter((st) => {
    if (filterPadding && !st.has_padding) return false;
    if (filterCrossing && !st.has_cache_line_crossing) return false;
    if (query && !st.name.toLowerCase().includes(query)) return false;
    return true;
  });

  if (countEl) countEl.textContent = `${filtered.length} structs displayed`;
  tbody.innerHTML = '';

  for (const st of filtered) {
    const tr = document.createElement('tr');
    const padPct = st.byte_size > 0 ? ((st.total_padding_bytes / st.byte_size) * 100).toFixed(0) : '0';

    let badges = '';
    if (st.has_padding) {
      badges += `<span class="badge badge-padding" style="margin-right: 4px;">⚠️ ${st.total_padding_bytes}B Pad (${padPct}%)</span>`;
    }
    if (st.has_cache_line_crossing) {
      badges += `<span class="badge badge-crossing" style="margin-right: 4px;">⚡ Cache Line Crossing</span>`;
    }
    if (st.optimal && st.optimal.bytes_saved > 0) {
      badges += `<span class="badge badge-optimal">💡 Saves ${st.optimal.bytes_saved}B</span>`;
    }

    tr.innerHTML = `
      <td>
        <div class="mono" style="font-weight: 700; color: #fff;">${escapeHtml(st.name)}</div>
        <div style="font-size: 0.72rem; color: var(--text-muted);">${escapeHtml(st.source_file)}:${st.source_line}</div>
      </td>
      <td class="mono">${st.byte_size} B</td>
      <td class="mono" style="color: var(--success);">${st.useful_bytes} B</td>
      <td class="mono" style="color: ${st.has_padding ? 'var(--danger)' : 'var(--text-secondary)'};">${st.total_padding_bytes} B</td>
      <td class="mono">${st.cache_lines_spanned} line${st.cache_lines_spanned > 1 ? 's' : ''}</td>
      <td>${badges || '<span style="color: var(--text-muted); font-size: 0.8rem;">Optimal</span>'}</td>
      <td>
        <button class="btn btn-sm inspect-btn" data-struct="${escapeHtml(st.name)}">Inspect X-Ray ➔</button>
      </td>
    `;

    const btn = tr.querySelector('.inspect-btn');
    if (btn) {
      btn.addEventListener('click', () => {
        selectStructByName(st.name);
        setActiveTab('xray');
      });
    }

    tbody.appendChild(tr);
  }
}

// ---------------------------------------------------------------------------
// 4. Struct Selector & Cache-Line X-Ray Rendering
// ---------------------------------------------------------------------------
function populateStructSelector(analysis: BinaryAnalysis): void {
  const select = document.getElementById('xray-struct-select') as HTMLSelectElement | null;
  if (!select) return;

  select.innerHTML = '';
  for (const st of analysis.structs) {
    const opt = document.createElement('option');
    opt.value = st.name;
    opt.textContent = `${st.name} (${st.byte_size}B${st.has_padding ? `, ${st.total_padding_bytes}B pad` : ''})`;
    select.appendChild(opt);
  }

  if (analysis.structs.length > 0) {
    selectStruct(analysis.structs[0]);
  }
}

function selectStructByName(name: string): void {
  if (!currentAnalysis) return;
  const found = currentAnalysis.structs.find((s) => s.name === name);
  if (found) {
    const select = document.getElementById('xray-struct-select') as HTMLSelectElement | null;
    if (select) select.value = name;
    selectStruct(found);
  }
}

function selectStruct(st: StructLayout): void {
  selectedStruct = st;
  renderStruct(st);
}

export function renderStruct(st: StructLayout): void {
  // Badges in header
  const badgesEl = document.getElementById('xray-badges');
  if (badgesEl) {
    badgesEl.innerHTML = `
      <span class="badge" style="background: var(--bg-tertiary); color: var(--text-primary); border: 1px solid var(--border-color);">Size: ${st.byte_size}B</span>
      <span class="badge" style="background: var(--bg-tertiary); color: var(--text-primary); border: 1px solid var(--border-color);">Align: ${st.alignment}B</span>
      <span class="badge ${st.has_padding ? 'badge-padding' : 'badge-optimal'}">Padding: ${st.total_padding_bytes}B</span>
      <span class="badge ${st.cache_lines_spanned > 1 ? 'badge-crossing' : ''}" style="background: var(--bg-tertiary); color: var(--text-primary); border: 1px solid var(--border-color);">${st.cache_lines_spanned} Cache Line${st.cache_lines_spanned > 1 ? 's' : ''}</span>
    `;
  }

  // Render the Cache-Line Grid
  renderCacheLineGrid(st);

  // Render Field Layout Table
  renderFieldLayoutTable(st);

  // Render Optimal Layout Snippet
  renderOptimalSnippet(st);
}

// ---------------------------------------------------------------------------
// Cache-Line Memory Grid (8 bytes/row, 64-byte blocks separated by bold borders)
// ---------------------------------------------------------------------------
interface ByteModel {
  offset: number;
  isPadding: boolean;
  memberIndex: number | null;
  memberName: string;
  memberType: string;
  memberSize: number;
  isCrossing: boolean;
}

function renderCacheLineGrid(st: StructLayout): void {
  const tbody = document.getElementById('cache-grid-tbody');
  const legend = document.getElementById('xray-member-legend');
  if (!tbody || !legend) return;

  tbody.innerHTML = '';
  legend.innerHTML = '';

  const totalBytes = Math.max(st.byte_size, 1);
  const byteMap: ByteModel[] = [];

  // Initialize all bytes as padding by default
  for (let i = 0; i < totalBytes; ++i) {
    byteMap.push({
      offset: i,
      isPadding: true,
      memberIndex: null,
      memberName: 'padding',
      memberType: 'padding',
      memberSize: 1,
      isCrossing: false,
    });
  }

  // Assign member bytes
  st.members.forEach((m, idx) => {
    for (let o = m.offset; o < m.offset + m.byte_size && o < totalBytes; ++o) {
      byteMap[o] = {
        offset: o,
        isPadding: false,
        memberIndex: idx,
        memberName: m.name,
        memberType: m.type_name,
        memberSize: m.byte_size,
        isCrossing: false,
      };
    }
  });

  // Assign cache line crossings
  st.cache_line_crossings.forEach((c) => {
    for (let o = c.member_offset; o < c.member_offset + c.member_size && o < totalBytes; ++o) {
      if (byteMap[o]) {
        byteMap[o].isCrossing = true;
      }
    }
  });

  // 8 bytes per row = 64-bit word
  const numRows = Math.ceil(totalBytes / 8);

  for (let r = 0; r < numRows; ++r) {
    const rowOffset = r * 8;

    // Cache-line boundary header every 8 rows (64 bytes)
    if (r % 8 === 0) {
      const lineIdx = Math.floor(r / 8);
      const lineStart = lineIdx * 64;
      const lineEnd = Math.min(lineStart + 63, totalBytes - 1);
      const bannerTr = document.createElement('tr');
      bannerTr.className = 'cache-line-banner';
      bannerTr.innerHTML = `
        <td colspan="9">
          ⚡ <strong>CACHE LINE #${lineIdx}</strong> &nbsp; [${formatHex(lineStart, 2)} &mdash; ${formatHex(lineEnd, 2)}] &nbsp; (${lineEnd - lineStart + 1} bytes)
        </td>
      `;
      tbody.appendChild(bannerTr);
    }

    const tr = document.createElement('tr');

    // Offset header on left
    const offsetTh = document.createElement('td');
    offsetTh.className = 'offset-header';
    offsetTh.textContent = `${formatHex(rowOffset, 2)} (+${rowOffset})`;
    tr.appendChild(offsetTh);

    // 8 Byte Cells
    for (let c = 0; c < 8; ++c) {
      const byteOffset = rowOffset + c;
      const td = document.createElement('td');

      if (byteOffset < totalBytes) {
        const b = byteMap[byteOffset];
        td.className = 'byte-cell';

        if (b.isPadding) {
          td.classList.add('byte-padding');
          td.innerHTML = `<span class="byte-num">+${byteOffset}</span><span class="byte-label">PAD</span>`;
          attachTooltip(td, `Offset +${byteOffset} (${formatHex(byteOffset, 2)}): Padding Hole (Unused Alignment Byte)`);
        } else {
          // Member byte
          const color = `hsl(${((b.memberIndex! * 53) % 360)}, 65%, 45%)`;
          td.style.backgroundColor = color;
          if (b.isCrossing) {
            td.classList.add('byte-crossing');
          }
          const shortName = b.memberName.length > 5 ? b.memberName.substring(0, 4) + '..' : b.memberName;
          td.innerHTML = `<span class="byte-num">+${byteOffset}</span><span class="byte-label">${escapeHtml(shortName)}</span>`;
          attachTooltip(
            td,
            `Offset +${byteOffset} (${formatHex(byteOffset, 2)})\n` +
            `Field: ${b.memberName}\n` +
            `Type: ${b.memberType} (${b.memberSize}B)\n` +
            (b.isCrossing ? `⚠️ Crosses 64-byte Cache Line boundary!` : `Cache Line: #${Math.floor(byteOffset / 64)}`)
          );
        }
      } else {
        // Empty cell beyond struct size
        td.className = 'byte-cell';
        td.style.background = 'transparent';
        td.style.opacity = '0.2';
        td.innerHTML = `<span class="byte-num">+${byteOffset}</span>`;
      }

      tr.appendChild(td);
    }

    tbody.appendChild(tr);
  }

  // Populate Member Color Legend
  st.members.forEach((m, idx) => {
    const item = document.createElement('div');
    item.className = 'legend-item';

    const colorBox = document.createElement('span');
    colorBox.className = 'legend-color';
    colorBox.style.backgroundColor = `hsl(${((idx * 53) % 360)}, 65%, 45%)`;

    const label = document.createElement('span');
    label.innerHTML = `<strong>${escapeHtml(m.name)}</strong>: <span class="mono" style="color: var(--text-secondary);">${escapeHtml(m.type_name)}</span> [${m.offset}..${m.offset + m.byte_size - 1}]`;

    item.appendChild(colorBox);
    item.appendChild(label);
    legend.appendChild(item);
  });

  // Add Padding item to legend
  if (st.has_padding) {
    const padItem = document.createElement('div');
    padItem.className = 'legend-item';
    padItem.innerHTML = `
      <span class="legend-color byte-padding" style="display: inline-block;"></span>
      <span><strong>Padding Holes:</strong> <span style="color: var(--danger);">${st.total_padding_bytes} Bytes Total</span></span>
    `;
    legend.appendChild(padItem);
  }
}

// Attach tooltip helper
function attachTooltip(el: HTMLElement, content: string): void {
  const tooltip = document.getElementById('cell-tooltip');
  if (!tooltip) return;

  el.addEventListener('mouseenter', (e) => {
    tooltip.innerHTML = content.replace(/\n/g, '<br/>');
    tooltip.style.display = 'block';
    tooltip.style.left = `${(e as MouseEvent).clientX + 14}px`;
    tooltip.style.top = `${(e as MouseEvent).clientY + 14}px`;
  });

  el.addEventListener('mousemove', (e) => {
    tooltip.style.left = `${(e as MouseEvent).clientX + 14}px`;
    tooltip.style.top = `${(e as MouseEvent).clientY + 14}px`;
  });

  el.addEventListener('mouseleave', () => {
    tooltip.style.display = 'none';
  });
}

// Render Field Layout Table
function renderFieldLayoutTable(st: StructLayout): void {
  const tbody = document.getElementById('fields-tbody');
  if (!tbody) return;
  tbody.innerHTML = '';

  for (const m of st.members) {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="mono">${formatHex(m.offset, 2)} (+${m.offset})</td>
      <td class="mono">${m.byte_size} B</td>
      <td class="mono" style="font-weight: 700; color: #fff;">${escapeHtml(m.name)}</td>
      <td class="mono" style="color: var(--accent);">${escapeHtml(m.type_name)}</td>
    `;
    tbody.appendChild(tr);

    // If padding hole follows this member, display it as an explicit sub-row
    const hole = st.padding_holes.find((h) => h.before === m.name);
    if (hole && hole.size > 0) {
      const padTr = document.createElement('tr');
      padTr.style.background = 'rgba(248, 81, 73, 0.08)';
      padTr.innerHTML = `
        <td class="mono" style="color: var(--danger);">${formatHex(hole.offset, 2)} (+${hole.offset})</td>
        <td class="mono" style="color: var(--danger); font-weight: 700;">${hole.size} B</td>
        <td colspan="2" style="color: var(--danger); font-size: 0.75rem;">
          ⚠️ <em>Padding Hole (${hole.size} bytes wasted alignment)</em>
        </td>
      `;
      tbody.appendChild(padTr);
    }
  }
}

// Render Optimal Reordering Code Snippet
function renderOptimalSnippet(st: StructLayout): void {
  const card = document.getElementById('optimal-card');
  const badge = document.getElementById('optimal-savings-badge');
  const codeEl = document.getElementById('optimal-cpp-code');
  if (!card || !badge || !codeEl) return;

  if (st.optimal && st.optimal.bytes_saved > 0) {
    card.style.display = 'block';
    badge.textContent = `Saves ${st.optimal.bytes_saved} Bytes (${Math.round((st.optimal.bytes_saved / st.byte_size) * 100)}% reduction)`;
    badge.className = 'badge badge-optimal';
    codeEl.textContent = st.optimal.cpp_snippet;
  } else {
    badge.textContent = 'Already Optimal';
    badge.className = 'badge';
    badge.style.background = 'var(--bg-tertiary)';
    badge.style.color = 'var(--text-secondary)';
    codeEl.textContent = '// Struct is already optimally packed!\n// Zero padding holes detected.';
  }
}

// ---------------------------------------------------------------------------
// 5. Diff Rendering
// ---------------------------------------------------------------------------
export function renderDiff(diff: DiffResult): void {
  currentDiff = diff;
  setState('diff');

  const filenamesEl = document.getElementById('diff-filenames');
  if (filenamesEl) {
    filenamesEl.textContent = `Base: ${diff.base_filename} ➔ Target: ${diff.target_filename}`;
  }

  // Diff Metric Cards
  const mFlash = document.getElementById('diff-metric-flash');
  const mFlashSub = document.getElementById('diff-metric-flash-sub');
  const mRam = document.getElementById('diff-metric-ram');
  const mRamSub = document.getElementById('diff-metric-ram-sub');
  const mFile = document.getElementById('diff-metric-filesize');
  const mFileSub = document.getElementById('diff-metric-filesize-sub');
  const mReg = document.getElementById('diff-metric-regression');
  const mRegSub = document.getElementById('diff-metric-regression-sub');

  if (mFlash) {
    mFlash.textContent = `${diff.flash_delta > 0 ? '+' : ''}${formatBytes(diff.flash_delta)}`;
    mFlash.className = `metric-card-val ${diff.flash_delta > 0 ? 'delta-positive' : diff.flash_delta < 0 ? 'delta-negative' : 'delta-neutral'}`;
  }
  if (mFlashSub) mFlashSub.textContent = `${diff.flash_pct > 0 ? '+' : ''}${diff.flash_pct.toFixed(2)}% flash growth`;

  if (mRam) {
    mRam.textContent = `${diff.ram_delta > 0 ? '+' : ''}${formatBytes(diff.ram_delta)}`;
    mRam.className = `metric-card-val ${diff.ram_delta > 0 ? 'delta-positive' : diff.ram_delta < 0 ? 'delta-negative' : 'delta-neutral'}`;
  }
  if (mRamSub) mRamSub.textContent = `${diff.ram_pct > 0 ? '+' : ''}${diff.ram_pct.toFixed(2)}% RAM growth`;

  if (mFile) {
    mFile.textContent = `${diff.file_size_delta > 0 ? '+' : ''}${formatBytes(diff.file_size_delta)}`;
    mFile.className = `metric-card-val ${diff.file_size_delta > 0 ? 'delta-positive' : diff.file_size_delta < 0 ? 'delta-negative' : 'delta-neutral'}`;
  }
  if (mFileSub) mFileSub.textContent = `${diff.file_size_pct > 0 ? '+' : ''}${diff.file_size_pct.toFixed(2)}% file delta`;

  if (mReg && mRegSub) {
    if (diff.has_padding_regression || diff.exceeded_growth_threshold) {
      mReg.textContent = 'REGRESSION DETECTED';
      mReg.className = 'metric-card-val delta-positive';
      mRegSub.textContent = 'Struct padding or threshold exceeded';
    } else {
      mReg.textContent = 'PASSED';
      mReg.className = 'metric-card-val delta-negative';
      mRegSub.textContent = 'No size or layout regressions';
    }
  }

  // Section Deltas Table
  const secTbody = document.getElementById('diff-sections-tbody');
  if (secTbody) {
    secTbody.innerHTML = '';
    for (const sd of diff.section_deltas) {
      const tr = document.createElement('tr');
      const deltaClass = sd.delta_bytes > 0 ? 'delta-positive' : sd.delta_bytes < 0 ? 'delta-negative' : 'delta-neutral';
      tr.innerHTML = `
        <td class="mono" style="font-weight: 600;">${escapeHtml(sd.name)}</td>
        <td class="mono">${formatBytes(sd.base_size)}</td>
        <td class="mono">${formatBytes(sd.target_size)}</td>
        <td class="mono ${deltaClass}">${sd.delta_bytes > 0 ? '+' : ''}${formatBytes(sd.delta_bytes)}</td>
        <td class="mono ${deltaClass}">${sd.delta_pct > 0 ? '+' : ''}${sd.delta_pct.toFixed(2)}%</td>
        <td><span class="badge" style="background: var(--bg-tertiary); text-transform: uppercase;">${escapeHtml(sd.change)}</span></td>
      `;
      secTbody.appendChild(tr);
    }
  }

  // Symbol Deltas Table
  const symTbody = document.getElementById('diff-symbols-tbody');
  if (symTbody) {
    symTbody.innerHTML = '';
    for (const sd of diff.symbol_deltas) {
      const tr = document.createElement('tr');
      const deltaClass = sd.delta_bytes > 0 ? 'delta-positive' : sd.delta_bytes < 0 ? 'delta-negative' : 'delta-neutral';
      tr.innerHTML = `
        <td class="mono" style="font-weight: 600; color: #fff;">${escapeHtml(sd.name)}</td>
        <td><span class="badge badge-code">${escapeHtml(sd.section)}</span></td>
        <td class="mono">${formatBytes(sd.base_size)}</td>
        <td class="mono">${formatBytes(sd.target_size)}</td>
        <td class="mono ${deltaClass}">${sd.delta_bytes > 0 ? '+' : ''}${formatBytes(sd.delta_bytes)}</td>
        <td><span class="badge" style="background: var(--bg-tertiary); text-transform: uppercase;">${escapeHtml(sd.change)}</span></td>
      `;
      symTbody.appendChild(tr);
    }
  }

  // Struct Regressions Table
  const structTbody = document.getElementById('diff-structs-tbody');
  if (structTbody) {
    structTbody.innerHTML = '';
    for (const sr of diff.struct_regressions) {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td class="mono" style="font-weight: 700; color: #fff;">${escapeHtml(sr.name)}</td>
        <td class="mono">${sr.size_delta > 0 ? '+' : ''}${sr.size_delta} B</td>
        <td class="mono ${sr.padding_delta > 0 ? 'delta-positive' : ''}">${sr.padding_delta > 0 ? '+' : ''}${sr.padding_delta} B</td>
        <td class="mono">${sr.cache_line_delta > 0 ? '+' : ''}${sr.cache_line_delta} lines</td>
        <td>
          ${sr.is_regression
            ? '<span class="badge badge-padding">⚠️ REGRESSION</span>'
            : '<span class="badge badge-optimal">OK</span>'}
        </td>
      `;
      structTbody.appendChild(tr);
    }
  }
}

// ---------------------------------------------------------------------------
// 6. Navigation and Tab Switching
// ---------------------------------------------------------------------------
function setActiveNav(nav: NavTab): void {
  activeNavTab = nav;
  document.querySelectorAll('.nav-btn').forEach((b) => {
    b.classList.toggle('active', (b as HTMLElement).dataset.nav === nav);
  });

  const aboutSection = document.getElementById('about-section');
  const resultsSection = document.getElementById('results-section');
  const diffSection = document.getElementById('diff-section');
  const controlsSection = document.getElementById('controls-section');

  if (nav === 'about') {
    if (aboutSection) aboutSection.style.display = 'flex';
    if (resultsSection) resultsSection.style.display = 'none';
    if (diffSection) diffSection.style.display = 'none';
    if (controlsSection) controlsSection.style.display = 'none';
  } else if (nav === 'diff') {
    if (aboutSection) aboutSection.style.display = 'none';
    if (controlsSection) controlsSection.style.display = 'grid';
    if (!currentDiff) {
      loadDiffSample();
    } else {
      setState('diff');
    }
  } else if (nav === 'structs') {
    if (aboutSection) aboutSection.style.display = 'none';
    if (controlsSection) controlsSection.style.display = 'grid';
    if (!currentAnalysis) {
      loadSampleData(0).then(() => {
        setActiveTab('structs');
      });
    } else {
      setState('analyze');
      setActiveTab('structs');
    }
  } else {
    // analyze
    if (aboutSection) aboutSection.style.display = 'none';
    if (controlsSection) controlsSection.style.display = 'grid';
    if (currentAnalysis) {
      setState('analyze');
    } else {
      setState('idle');
    }
  }
}

function setActiveTab(tab: ActiveTab): void {
  activeResultsTab = tab;
  document.querySelectorAll('.results-tab-btn').forEach((b) => {
    b.classList.toggle('active', (b as HTMLElement).dataset.tab === tab);
  });

  const tabOverview = document.getElementById('tab-overview');
  const tabSymbols = document.getElementById('tab-symbols');
  const tabStructs = document.getElementById('tab-structs');
  const tabXray = document.getElementById('tab-xray');

  if (tabOverview) tabOverview.style.display = tab === 'overview' ? 'block' : 'none';
  if (tabSymbols) tabSymbols.style.display = tab === 'symbols' ? 'block' : 'none';
  if (tabStructs) tabStructs.style.display = tab === 'structs' ? 'block' : 'none';
  if (tabXray) tabXray.style.display = tab === 'xray' ? 'block' : 'none';
}

// ---------------------------------------------------------------------------
// 7. Event Listeners & Bootstrapping
// ---------------------------------------------------------------------------
function setupEventListeners(): void {
  // Navigation tabs
  document.querySelectorAll('.nav-btn').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      const nav = (e.currentTarget as HTMLElement).dataset.nav as NavTab;
      if (nav) setActiveNav(nav);
    });
  });

  // Results sub-tabs
  document.querySelectorAll('.results-tab-btn').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      const tab = (e.currentTarget as HTMLElement).dataset.tab as ActiveTab;
      if (tab) setActiveTab(tab);
    });
  });

  // Alert close
  const alertClose = document.getElementById('alert-close-btn');
  if (alertClose) {
    alertClose.addEventListener('click', hideAlert);
  }

  // Demo buttons
  document.getElementById('demo-btn-0')?.addEventListener('click', () => loadSampleData(0));
  document.getElementById('demo-btn-1')?.addEventListener('click', () => loadSampleData(1));
  document.getElementById('demo-btn-2')?.addEventListener('click', () => loadSampleData(2));
  document.getElementById('demo-diff-btn')?.addEventListener('click', () => loadDiffSample());

  // Dropzone drag-and-drop
  const dropzone = document.getElementById('file-dropzone');
  const fileInput = document.getElementById('file-input') as HTMLInputElement | null;

  if (dropzone && fileInput) {
    dropzone.addEventListener('click', () => fileInput.click());

    fileInput.addEventListener('change', (e) => {
      const files = (e.target as HTMLInputElement).files;
      if (files && files.length > 0) {
        handleFileDrop(files[0]);
      }
    });

    ['dragenter', 'dragover'].forEach((eventName) => {
      dropzone.addEventListener(eventName, (e) => {
        e.preventDefault();
        e.stopPropagation();
        dropzone.classList.add('drag-active');
      });
    });

    ['dragleave', 'drop'].forEach((eventName) => {
      dropzone.addEventListener(eventName, (e) => {
        e.preventDefault();
        e.stopPropagation();
        dropzone.classList.remove('drag-active');
      });
    });

    dropzone.addEventListener('drop', (e: DragEvent) => {
      const dt = e.dataTransfer;
      if (dt && dt.files && dt.files.length > 0) {
        handleFileDrop(dt.files[0]);
      }
    });
  }

  // Global window drag-over prevention
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', (e) => e.preventDefault());

  // Symbols Filtering
  document.getElementById('symbol-search')?.addEventListener('input', () => {
    if (currentAnalysis) renderSymbolsTable(currentAnalysis);
  });
  document.getElementById('symbol-type-filter')?.addEventListener('change', () => {
    if (currentAnalysis) renderSymbolsTable(currentAnalysis);
  });
  document.getElementById('symbol-sort')?.addEventListener('change', () => {
    if (currentAnalysis) renderSymbolsTable(currentAnalysis);
  });

  // Structs Filtering
  document.getElementById('struct-search')?.addEventListener('input', () => {
    if (currentAnalysis) renderStructsTable(currentAnalysis);
  });
  document.getElementById('struct-filter-padding')?.addEventListener('change', () => {
    if (currentAnalysis) renderStructsTable(currentAnalysis);
  });
  document.getElementById('struct-filter-crossing')?.addEventListener('change', () => {
    if (currentAnalysis) renderStructsTable(currentAnalysis);
  });

  // Struct select in X-Ray
  document.getElementById('xray-struct-select')?.addEventListener('change', (e) => {
    const val = (e.target as HTMLSelectElement).value;
    selectStructByName(val);
  });

  // Copy C++ snippet button
  document.getElementById('btn-copy-cpp')?.addEventListener('click', async () => {
    const codeEl = document.getElementById('optimal-cpp-code');
    const copyBtn = document.getElementById('btn-copy-cpp');
    if (codeEl && copyBtn) {
      await navigator.clipboard.writeText(codeEl.textContent || '');
      const orig = copyBtn.textContent;
      copyBtn.textContent = 'Copied!';
      setTimeout(() => {
        copyBtn.textContent = orig;
      }, 2000);
    }
  });
}

// ---------------------------------------------------------------------------
// Application Entry Point
// ---------------------------------------------------------------------------
async function init(): Promise<void> {
  setupEventListeners();

  // Try to load WebAssembly module
  try {
    wasmEngine = await loadWasmModule();
    const wasmBadge = document.getElementById('wasm-badge');
    if (wasmBadge) {
      if (wasmEngine) {
        wasmBadge.textContent = 'WASM: Active';
        wasmBadge.classList.add('ready');
      } else {
        wasmBadge.textContent = 'CLI / JSON Mode';
      }
    }
  } catch (err) {
    console.warn('Wasm initialization skipped:', err);
  }

  // Automatically load the first demo sample for a rich initial presentation
  await loadSampleData(0);
}

// Start application when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
