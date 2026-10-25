// Run before Desktop modules: randomUUID is unavailable on LAN HTTP origins,
// but getRandomValues still provides the cryptographically secure bytes we need.
(() => {
  const crypto = globalThis.crypto;
  if (typeof crypto?.randomUUID === "function") return;
  if (typeof crypto?.getRandomValues !== "function") {
    throw new Error("Codex Web requires crypto.getRandomValues to generate UUIDs");
  }

  Object.defineProperty(crypto, "randomUUID", {
    configurable: true,
    writable: true,
    value: function randomUUID() {
      const bytes = crypto.getRandomValues(new Uint8Array(16));
      bytes[6] = (bytes[6] & 0x0f) | 0x40;
      bytes[8] = (bytes[8] & 0x3f) | 0x80;
      const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0"));
      return [
        hex.slice(0, 4).join(""),
        hex.slice(4, 6).join(""),
        hex.slice(6, 8).join(""),
        hex.slice(8, 10).join(""),
        hex.slice(10, 16).join(""),
      ].join("-");
    },
  });
})();
