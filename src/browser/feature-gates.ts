export type StatsigGateEvaluation = {
  name: string;
  value: boolean;
  [key: string]: unknown;
};

// Browser compatibility choices for the pinned Desktop version. These are UI
// rollout gates, not account entitlements; upstream access checks still apply.
const browserGates = new Set([
  "2911712394", // Existing upstream browser compatibility override.
  "1042620455", // Remote control (Slingshot).
  "4039078146", // Activity bell AND contextual sidebar selection.
]);

export function getBrowserGateOverride(
  evaluation: StatsigGateEvaluation,
): StatsigGateEvaluation | null {
  // Realtime voice is a native desktop runtime, distinct from browser dictation.
  // It must not replace Send with a control that can only operate the server PC.
  if (evaluation.name === "2380644311") return { ...evaluation, value: false };
  return browserGates.has(evaluation.name)
    ? { ...evaluation, value: true }
    : null;
}
