// Isometric (2:1) projection for 32×16 base tiles. Tile (col, row) → screen position of the tile's top corner.
export const TILE_W = 32;
export const TILE_H = 16;

export function tileToScreen(col: number, row: number): { x: number; y: number } {
  return { x: (col - row) * (TILE_W / 2), y: (col + row) * (TILE_H / 2) };
}

/** Screen (world) position → tile (col, row), floored. The inverse of tileToScreen. */
export function screenToTile(x: number, y: number): { col: number; row: number } {
  const a = x / (TILE_W / 2);
  const b = y / (TILE_H / 2);
  return { col: Math.floor((a + b) / 2), row: Math.floor((b - a) / 2) };
}
