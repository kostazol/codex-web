(() => {
  if (!window.isSecureContext || !("serviceWorker" in navigator)) return;
  let checking = false;
  let lastCheck = 0;
  let registration;
  function readyNotice() {
    if (!registration?.waiting || document.getElementById("codex-pwa-update"))
      return;
    const notice = document.createElement("div");
    notice.id = "codex-pwa-update";
    notice.setAttribute("role", "status");
    notice.style.cssText =
      "position:fixed;bottom:max(16px,env(safe-area-inset-bottom));left:16px;right:16px;z-index:2147483646;padding:14px 48px 14px 16px;border:1px solid #666;border-radius:14px;background:#202124;color:#fff;font:14px/1.4 system-ui;box-shadow:0 4px 24px #0006";
    notice.textContent =
      "Обновление Codex Web готово. Оно применится после закрытия его вкладок и PWA.";
    const close = document.createElement("button");
    close.textContent = "×";
    close.setAttribute("aria-label", "Закрыть уведомление");
    close.style.cssText =
      "position:absolute;right:0;top:0;width:44px;height:44px;border:0;background:none;color:inherit;font-size:24px";
    close.onclick = () => notice.remove();
    notice.append(close);
    document.body?.append(notice);
  }
  async function check() {
    if (
      checking ||
      document.visibilityState === "hidden" ||
      navigator.onLine === false ||
      Date.now() - lastCheck < 60_000
    )
      return;
    checking = true;
    lastCheck = Date.now();
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), 5000);
    try {
      const response = await fetch("/pwa-version.json", {
        cache: "no-store",
        signal: abort.signal,
      });
      if (!response.ok) return;
      const { version } = await response.json();
      if (!/^[a-f0-9]{24}$/.test(version)) return;
      registration ??= await navigator.serviceWorker.getRegistration("/");
      const newest =
        registration?.installing ||
        registration?.waiting ||
        registration?.active;
      if (
        !newest ||
        new URL(newest.scriptURL).searchParams.get("v") !== version
      ) {
        registration = await navigator.serviceWorker.register(
          `/pwa-worker.js?v=${version}`,
          { scope: "/", updateViaCache: "none" },
        );
        registration.addEventListener("updatefound", () => {
          registration.installing?.addEventListener("statechange", readyNotice);
        });
        registration.installing?.addEventListener("statechange", readyNotice);
      }
      document.documentElement.dataset.codexPwaVersion = version;
      readyNotice();
    } catch {
      /* Offline/unavailable checks never block the cached interface. */
    } finally {
      clearTimeout(timer);
      checking = false;
    }
  }
  function controlled() {
    const controller = navigator.serviceWorker.controller;
    document.documentElement.dataset.codexPwaCache = controller
      ? "ready"
      : "installing";
    document.documentElement.dataset.codexPwaActiveVersion =
      controller?.scriptURL
        ? (new URL(controller.scriptURL).searchParams.get("v") ?? "")
        : "";
  }
  navigator.serviceWorker.addEventListener("controllerchange", controlled);
  document.addEventListener("visibilitychange", check);
  window.addEventListener("online", check);
  controlled();
  void check();
})();
