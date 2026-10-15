import { type QuestDef, readyToReport } from '@mikazuki/shared';
import { adventure, newGuidedQuest, onAdventure, questDef } from '../net/adventure';
import { type GuideAim, setGuide } from './guide-arrow';

// 🧭 The quest guide's arrow (CONTEXT.md "Guided quest", "Guide arrow"): for a guided quest only, in its colour.
//   • Report: a guided quest ready to report (readyToReport): the arrow right of its Report button in the tracker, or
//     of the tracker's + while the tracker is folded (that unfolds it). It goes once it's reported.
//   • The quest button: a guided quest that started since the log was last opened (net/adventure.ts newGuidedQuest);
//     below the button when it's near the top of the screen (left of it where the HUD's buttons stack in a column),
//     else left of it. Opening the log (J, the button, a click
//     on the tracker) sees it, so the arrow goes: once for each guided quest as it starts.
// Report wins when both apply. Lessons (ui/lessons.ts) wait while this arrow shows.

export function mountQuestGuide(): void {
  let fresh: QuestDef | null = null;
  onAdventure(() => (fresh = newGuidedQuest()));
  fresh = newGuidedQuest();
  setGuide('quest', (): GuideAim | null => {
    const s = adventure();
    if (!s) return null;
    const tracker = document.getElementById('quest-tracker');
    for (const p of s.quests.active) {
      const q = questDef(p.id);
      if (!q?.guided || !readyToReport(q, p) || !tracker || tracker.hidden) continue;
      const folded = tracker.classList.contains('qt-folded');
      const target = tracker.querySelector<HTMLElement>(folded ? '.qt-fold' : `.qt-quest[data-quest="${CSS.escape(p.id)}"] .qt-report:not(:disabled)`);
      if (target) return { target, type: q.type, sides: ['right', 'below'] };
    }
    const button = document.getElementById('quest-button');
    if (!fresh || !button) return null;
    // Below it near the top of the screen, unless the HUD's buttons stack in a column there (phones: the next one is
    // under it); else left of it.
    const r = button.getBoundingClientRect();
    const next = (button.nextElementSibling as HTMLElement | null)?.getBoundingClientRect();
    const column = !!next && next.width > 0 && next.top >= r.bottom - 2;
    const below = r.top < innerHeight * 0.3 && !column;
    return { target: button, type: fresh.type, sides: below ? ['below', 'left'] : ['left', 'below'] };
  });
}
