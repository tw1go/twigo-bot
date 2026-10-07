import type { ClassInfo } from '@mikazuki/shared';
import { playSound } from '../audio/sound';
import { toast } from './toast';

// 🔀 Dev (?switch): a row of the six class badges (and "none") at the bottom left; a click makes you that class at
// once (net/adventure.ts devSwitchClass: its training weapon, the class choice done). Only with the pretend login.

export function mountClassSwitch(o: { classes: ClassInfo[]; badge: (cls: string) => string; current: () => string | null; pick: (cls: string | null) => void }): () => void {
  const root = document.createElement('div');
  root.id = 'class-switch';
  root.setAttribute('aria-label', 'Switch class (dev)');
  const buttons: [string | null, HTMLButtonElement][] = [];
  const add = (cls: string | null, label: string) => {
    const b = document.createElement('button');
    b.title = label;
    b.setAttribute('aria-label', label);
    if (cls) {
      const img = document.createElement('img');
      img.src = o.badge(cls);
      img.alt = '';
      b.append(img);
    } else b.textContent = '∅';
    b.addEventListener('click', () => {
      o.pick(cls);
      playSound('click');
      toast(cls ? `You're a ${label} now.` : 'No class now.', 1500);
      mark();
    });
    buttons.push([cls, b]);
    root.append(b);
  };
  for (const c of o.classes) add(c.id, c.name);
  add(null, 'No class');
  const mark = () => {
    for (const [cls, b] of buttons) b.classList.toggle('cs-on', cls === o.current());
  };
  mark();
  document.body.append(root);
  return () => root.remove();
}
