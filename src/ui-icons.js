/**
 * Shared monoline SVG icons for the CAD UI chrome.
 * Uses currentColor and 1.75 stroke-width to stay crisp across all surfaces.
 */
const ICON_PATHS = {
  cube: '<path d="M12 3l8 4.5v9L12 21l-8-4.5v-9L12 3z"/><path d="M12 21v-9m8-4.5L12 12M4 7.5L12 12"/>',
  draft2d: '<path d="M3 20h18M5 20V5l14 15"/><path d="M9 20v-6h6"/>',
  eye: '<path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z"/><circle cx="12" cy="12" r="3"/>',
  slant: '<polygon points="4 4 20 4 4 20"/><line x1="4" y1="20" x2="20" y2="4" stroke-dasharray="2.5 2.5"/>',
  poly: '<polygon points="12 2 21 7.5 21 16.5 12 22 3 16.5 3 7.5"/>',
  corner: '<path d="M4 20h16V4"/><path d="M4 20L20 4"/>',
  box: '<rect x="3" y="3" width="18" height="18" rx="1.5"/><rect x="8" y="8" width="8" height="8" stroke-dasharray="2 2"/>',
  vgroove: '<path d="M3 6h5l4 11 4-11h5"/>',
  circle: '<circle cx="12" cy="12" r="7.5"/>',
  hole: '<circle cx="12" cy="12" r="7.5"/><circle cx="12" cy="12" r="2.2" stroke-dasharray="2 2"/>',
  fillet: '<path d="M4 20V11a7 7 0 0 1 7-7h9"/>',
  cut: '<circle cx="6" cy="6" r="2.5"/><circle cx="6" cy="18" r="2.5"/><path d="M20 4L8.1 15.9M14.5 14.5L20 20M8.1 8.1L12 12"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  ruler: '<path d="M3 12h18M6 8l-3 4 3 4M18 8l3 4-3 4"/>',
  angle: '<path d="M4 19h16M4 19L17 6"/><path d="M11 19a7 7 0 0 0-2.1-5"/>',
  faces: '<path d="M12 3l8 4.5-8 4.5-8-4.5L12 3z"/><path d="M4 12l8 4.5 8-4.5"/><path d="M4 16.5L12 21l8-4.5"/>',
  points: '<circle cx="5" cy="12" r="2.5"/><circle cx="19" cy="12" r="2.5"/><line x1="7.5" y1="12" x2="16.5" y2="12" stroke-dasharray="2.5 2.5"/>',
  radial: '<circle cx="12" cy="12" r="7"/><path d="M12 12l5-5m-3.5 0H17v3.5"/>',
  grid: '<rect x="3" y="3" width="18" height="18" rx="1"/><path d="M9 3v18M15 3v18M3 9h18M3 15h18"/>',
  screens: '<rect x="3" y="4" width="18" height="12" rx="1.5"/><path d="M8 20h8M12 16v4"/>',
  inspect: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>',
  trash: '<path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/>',
  copy: '<rect x="9" y="9" width="11" height="11" rx="1.5"/><path d="M5 15H4a1.5 1.5 0 0 1-1.5-1.5V4A1.5 1.5 0 0 1 4 2.5h9.5A1.5 1.5 0 0 1 15 4v1"/>',
  close: '<path d="M18 6L6 18M6 6l12 12"/>',
  undo: '<path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13"/>',
  redo: '<path d="M21 7v6h-6"/><path d="M3 17a9 9 0 0 1 9-9 9 9 0 0 1 6 2.3l3 2.7"/>',
  rotate: '<path d="M21 12a9 9 0 1 1-2.6-6.4L21 8"/><path d="M21 3v5h-5"/>',
  snap: '<rect x="4" y="4" width="4" height="4"/><rect x="16" y="4" width="4" height="4"/><rect x="4" y="16" width="4" height="4"/><rect x="16" y="16" width="4" height="4"/>',
  magnet: '<path d="M6 15v-4a6 6 0 1 1 12 0v4"/><path d="M6 15v3a1 1 0 0 0 1 1h2a1 1 0 0 0 1-1v-3m4 0v3a1 1 0 0 0 1 1h2a1 1 0 0 0 1-1v-3M6 12h4m4 0h4"/>',
  cloud: '<path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z"/>',
  lock: '<rect x="5" y="11" width="14" height="10" rx="1.5"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  unlock: '<rect x="5" y="11" width="14" height="10" rx="1.5"/><path d="M8 11V7a4 4 0 0 1 7.8-1.2"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 20a8 8 0 0 1 16 0"/>',
  sliders: '<path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="2"/><circle cx="15" cy="17" r="2"/>',
  chevronLeft: '<polyline points="15 18 9 12 15 6"/>',
  check: '<polyline points="20 6 9 17 4 12"/>',
  alert: '<path d="M12 9v4m0 4h.01"/><path d="M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/>',
  pencil: '<path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
  arc: '<path d="M4 17a8 8 0 0 1 16 0"/>',
  move: '<path d="M12 2v20M2 12h20M9 5l3-3 3 3M9 19l3 3 3-3M5 9l-3 3 3 3M19 9l3 3-3 3"/>',
  layers: '<line x1="3" y1="8" x2="21" y2="8"/><line x1="3" y1="16" x2="21" y2="16" stroke-dasharray="3.5 3"/>'
};

export function svgIcon(name, size = 15, className = 'ui-svg') {
  const path = ICON_PATHS[name] || ICON_PATHS.cube;
  return `<svg class="${className}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${path}</svg>`;
}

export function createSvgElement(name, size = 15, className = 'ui-svg') {
  const tpl = document.createElement('template');
  tpl.innerHTML = svgIcon(name, size, className).trim();
  return tpl.content.firstElementChild;
}
