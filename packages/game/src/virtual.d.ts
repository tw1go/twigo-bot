// The pack index from scripts/packs.ts (PackIndex): null in dev.
declare module 'virtual:packs' {
  const index: { pages: string[]; files: Record<string, [number, number, number, number, number]> } | null;
  export default index;
}
