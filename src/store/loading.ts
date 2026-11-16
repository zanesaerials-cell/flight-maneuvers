import { useSyncExternalStore } from 'react';

/** Whether a 3D model file is still downloading, for the "Loading" note over the 3D view. */
let loading = false;
const listeners = new Set<() => void>();
export function setModelLoading(v: boolean) {
  if (v === loading) return;
  loading = v;
  listeners.forEach((l) => l());
}
export const useModelLoading = () => useSyncExternalStore((l) => { listeners.add(l); return () => { listeners.delete(l); }; }, () => loading);
