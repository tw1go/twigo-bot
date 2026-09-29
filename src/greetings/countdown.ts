const DAY_MS = 86_400_000;

/** Days from `today` (YYYY-MM-DD) to month/day, as whole calendar days. */
function daysUntil(today: string, year: number, month: number, day: number): number {
  const [y, m, d] = today.split('-').map(Number);
  return Math.round((Date.UTC(year, month - 1, day) - Date.UTC(y, m - 1, d)) / DAY_MS);
}

const plural = (n: number) => (n === 1 ? '1 day' : `${n} days`);

/** Christmas countdown until Dec 25, then New Year countdown until Jan 1. */
export function holidayCountdown(today: string): string {
  const [year, month, day] = today.split('-').map(Number);

  if (month === 1 && day === 1) return `🎆 **Happy New Year ${year}!** Wishing you all a wonderful year ahead!`;
  if (month === 12 && day === 25) return '🎄 **Merry Christmas!** Wishing you all a joyful day!';
  if (month === 12 && day > 25) {
    return `🎆 **${plural(daysUntil(today, year + 1, 1, 1))}** left until New Year ${year + 1}!`;
  }
  return `🎄 **${plural(daysUntil(today, year, 12, 25))}** left until Christmas!`;
}
