// ⏱️ A damage skill's cooldown (s) by the level it's learnt at: 0.8 + 0.15 a level, to a tenth (Lv 1: 1 s, Lv 3: 1.3 s,
// Lv 6: 1.7 s, Lv 9: 2.2 s, Lv 12: 2.6 s, Lv 15: 3.1 s, Lv 18: 3.5 s). The bot enforces the same (web/town-mobs.ts
// skillCooldown): keep them in step.

export const skillCooldown = (level: number) => Math.round((0.8 + 0.15 * Math.max(1, level)) * 10) / 10;
