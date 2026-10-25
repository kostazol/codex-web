import type { BrowserFilePicker } from "./file-picker";

// The remote host is the Windows/Mac server, not the browser's device. Exposing
// its microphone lease/capture APIs makes Desktop wait for native OS services
// before it ever calls getUserMedia on the phone. Keep upstream's browser path.
const nativeAudioServices = new Set<PropertyKey>([
  "realtimeVoice",
  "realtimeVoiceRuntime",
  "microphoneCapture",
  "systemPermissions",
  "dictationAudio",
]);

export function adaptBrowserAppHost<T>(
  host: T,
  pickFiles?: BrowserFilePicker,
): T {
  if (host == null || (typeof host !== "object" && typeof host !== "function"))
    return host;
  // Preserve SSH transfers, image persistence and other attachment RPCs. Only
  // opening the OS picker belongs to the phone/browser, not the server PC.
  const remoteFiles = pickFiles
    ? Reflect.get(host, "fileAttachments", host)
    : undefined;
  const browserFiles = pickFiles
    ? new Proxy(remoteFiles ?? {}, {
        get(target, key) {
          return key === "pickFiles"
            ? pickFiles
            : Reflect.get(target, key, target);
        },
      })
    : undefined;
  return new Proxy(host, {
    get(target, key) {
      if (key === "fileAttachments" && browserFiles) return browserFiles;
      return nativeAudioServices.has(key)
        ? undefined
        : Reflect.get(target, key, target);
    },
  }) as T;
}
