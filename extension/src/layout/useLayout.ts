import { inject } from 'vue';

export function useLayout() {
  const setTitle = inject<(t: string) => void>('setTitle');
  if (!setTitle) throw new Error('setTitle not provided');
  return { setTitle };
}
