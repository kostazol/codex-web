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

export function adaptBrowserAppHost<T>(host: T): T {
  if (host == null || (typeof host !== "object" && typeof host !== "function"))
    return host;
  return new Proxy(host, {
    get(target, key) {
      return nativeAudioServices.has(key)
        ? undefined
        : Reflect.get(target, key, target);
    },
  }) as T;
}
