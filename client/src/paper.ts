// Paper sizes for the printed bill, in millimetres (width x height, portrait).
export const PAPERS: [key: string, label: string, w: number, h: number][] = [
  ['A4', 'A4 (210 × 297 mm)', 210, 297],
  ['A5', 'A5 (148 × 210 mm)', 148, 210],
  ['A6', 'A6 (105 × 148 mm)', 105, 148],
  ['Letter', 'Letter (216 × 279 mm)', 216, 279],
  ['Legal', 'Legal (216 × 356 mm)', 216, 356],
  ['Roll80', 'Receipt roll 80 mm', 80, 297],
  ['Roll58', 'Receipt roll 58 mm', 58, 297],
  ['Custom', 'Custom size', 210, 297],
];

export type PrintCfg = { paper?: string; width?: number; height?: number; orientation?: 'portrait' | 'landscape'; margin?: number; fontSize?: number };

/** Page size in mm for a saved setting, orientation applied. */
export function pageSize(c: PrintCfg): { w: number; h: number } {
  const p = PAPERS.find(([k]) => k === (c.paper || 'A4')) || PAPERS[0];
  const isCustom = p[0] === 'Custom';
  const isRoll = p[0].startsWith('Roll');
  let w = isCustom ? Number(c.width) || p[2] : p[2];
  let h = isCustom || isRoll ? Number(c.height) || p[3] : p[3];
  if (c.orientation === 'landscape') [w, h] = [h, w];
  return { w, h };
}
