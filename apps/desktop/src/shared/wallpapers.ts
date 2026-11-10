/** Nude's homepage wallpapers. `focus` = the part of the photo to keep in view when the window crops it. */
export interface Wallpaper { id: string; name: string; file: string; thumb: string; focus: string }

export const WALLPAPERS: Wallpaper[] = [
  { id: 'golden-path', name: 'Golden path', file: 'golden-path.jpg', thumb: 'golden-path-thumb.jpg', focus: '50% 60%' },
  { id: 'lone-tree', name: 'Lone tree', file: 'lone-tree.jpg', thumb: 'lone-tree-thumb.jpg', focus: '50% 45%' },
  { id: 'mountain-mirror', name: 'Mountain mirror', file: 'mountain-mirror.jpg', thumb: 'mountain-mirror-thumb.jpg', focus: '50% 45%' },
  { id: 'fern-lake', name: 'Fern lake', file: 'fern-lake.jpg', thumb: 'fern-lake-thumb.jpg', focus: '50% 50%' },
];

/** The Nude default. */
export const DEFAULT_WALLPAPER = 'golden-path';
export const WALLPAPER_IDS = [...WALLPAPERS.map((w) => w.id), 'custom'];
