import { mdiClose, mdiPause, mdiPlayOutline, mdiRestore } from '@mdi/js';

const paths = { close:mdiClose, pause:mdiPause, play:mdiPlayOutline, restore:mdiRestore };
export function icon(name: keyof typeof paths) {
  return `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="${paths[name]}"/></svg>`;
}
