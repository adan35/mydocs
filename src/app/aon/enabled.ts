import { useSettings } from '../settings-store';

/** Whether AON is switched on in Settings. Off hides every entry point. */
export const aonEnabled = () => useSettings.getState().showAon;
export const useAonEnabled = () => useSettings((s) => s.showAon);
