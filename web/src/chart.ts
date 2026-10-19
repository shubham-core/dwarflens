// DwarfLens SVG Size History Line Chart

import { AnalysisSummary } from './api';

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function renderSizeHistoryChart(container: HTMLElement, data: AnalysisSummary[]): void {
  container.innerHTML = '';

  if (!data || data.length === 0) {
    container.innerHTML = '<div style="color: var(--text-muted); text-align: center; padding: 2rem;">No analysis history available yet.</div>';
    return;
  }

  // Sort chronologically ascending
  const sorted = [...data].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

  const width = container.clientWidth || 700;
  const height = 240;
  const padding = { top: 20, right: 30, bottom: 40, left: 60 };

  const innerWidth = width - padding.left - padding.right;
  const innerHeight = height - padding.top - padding.bottom;

  const minSize = Math.min(...sorted.map((d) => d.totalSize)) * 0.95;
  const maxSize = Math.max(...sorted.map((d) => d.totalSize)) * 1.05;
  const sizeRange = maxSize - minSize || 1;

  const points = sorted.map((d, index) => {
    const x = padding.left + (sorted.length === 1 ? innerWidth / 2 : (index / (sorted.length - 1)) * innerWidth);
    const y = padding.top + innerHeight - ((d.totalSize - minSize) / sizeRange) * innerHeight;
    return { x, y, data: d };
  });

  const pathD = points.length === 1
    ? `M ${points[0].x - 10} ${points[0].y} L ${points[0].x + 10} ${points[0].y}`
    : points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');

  const areaD = points.length > 1
    ? `${pathD} L ${points[points.length - 1].x.toFixed(1)} ${height - padding.bottom} L ${points[0].x.toFixed(1)} ${height - padding.bottom} Z`
    : '';

  // SVG Elements
  let svg = `
    <svg width="100%" height="${height}" viewBox="0 0 ${width} ${height}" style="overflow: visible; font-family: var(--font-sans);">
      <defs>
        <linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#58a6ff" stop-opacity="0.3" />
          <stop offset="100%" stop-color="#58a6ff" stop-opacity="0.0" />
        </linearGradient>
      </defs>

      <!-- Grid lines & Y Axis -->
      <line x1="${padding.left}" y1="${padding.top}" x2="${width - padding.right}" y2="${padding.top}" stroke="var(--border-color)" stroke-dasharray="3,3" />
      <text x="${padding.left - 8}" y="${padding.top + 4}" fill="var(--text-muted)" font-size="11" text-anchor="end">${formatBytes(maxSize)}</text>

      <line x1="${padding.left}" y1="${padding.top + innerHeight / 2}" x2="${width - padding.right}" y2="${padding.top + innerHeight / 2}" stroke="var(--border-color)" stroke-dasharray="3,3" />
      <text x="${padding.left - 8}" y="${padding.top + innerHeight / 2 + 4}" fill="var(--text-muted)" font-size="11" text-anchor="end">${formatBytes((minSize + maxSize) / 2)}</text>

      <line x1="${padding.left}" y1="${height - padding.bottom}" x2="${width - padding.right}" y2="${height - padding.bottom}" stroke="var(--border-color)" />
      <text x="${padding.left - 8}" y="${height - padding.bottom + 4}" fill="var(--text-muted)" font-size="11" text-anchor="end">${formatBytes(minSize)}</text>

      <!-- Area fill -->
      ${areaD ? `<path d="${areaD}" fill="url(#areaGrad)" />` : ''}

      <!-- Main Line -->
      <path d="${pathD}" fill="none" stroke="#58a6ff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" />

      <!-- Data Dots -->
      ${points.map((p) => `
        <circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="4.5" fill="#1c2128" stroke="#58a6ff" stroke-width="2" style="cursor: pointer;">
          <title>${p.data.branch} @ ${p.data.commitSha.substring(0, 7)}: ${formatBytes(p.data.totalSize)} (${new Date(p.data.createdAt).toLocaleDateString()})</title>
        </circle>
      `).join('')}

      <!-- X Axis Labels -->
      ${points.map((p, i) => {
        if (sorted.length > 8 && i % Math.ceil(sorted.length / 6) !== 0 && i !== sorted.length - 1) return '';
        const dateStr = new Date(p.data.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
        return `<text x="${p.x.toFixed(1)}" y="${height - 12}" fill="var(--text-muted)" font-size="10" text-anchor="middle">${dateStr}</text>`;
      }).join('')}
    </svg>
  `;

  container.innerHTML = svg;
}
