const restored = new WeakMap<object, Set<string>>();
const key = (mode: string) => `codex-web:activity-view:${mode}`;

export function saveActivityView(mode: string | undefined, enabled: boolean) {
  if (!mode) return;
  try {
    localStorage.setItem(key(mode), String(enabled));
  } catch {
    // Storage can be unavailable; the native toggle must still work.
  }
}

export function restoreActivityView(
  owner: object,
  mode: string,
  activate: () => void,
) {
  let modes = restored.get(owner);
  if (!modes) restored.set(owner, (modes = new Set()));
  if (modes.has(mode)) return;
  modes.add(mode);
  let enabled = false;
  try {
    enabled = localStorage.getItem(key(mode)) === "true";
  } catch {
    return;
  }
  // Use the native activation flow, including its live list subscription.
  if (enabled) activate();
}
