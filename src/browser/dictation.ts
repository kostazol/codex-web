import styles from "../../assets/dictation.css?inline";

export const MAX_AUDIO_BYTES = 20 * 1024 * 1024;
export const MAX_RECORDING_MS = 5 * 60 * 1000;
export const AUDIO_ACCEPT = "audio/*,.webm,.mp3,.m4a,.mp4,.wav,.ogg,.flac";

export function validateAudio(
  audio: Blob,
  name = audio instanceof File ? audio.name : "",
) {
  if (!audio.size) throw new Error("Файл пуст. Выберите запись с речью.");
  if (audio.size > MAX_AUDIO_BYTES)
    throw new Error("Запись слишком большая. Максимум — 20 МБ.");
  if (
    !audio.type.startsWith("audio/") &&
    !/\.(webm|mp3|m4a|mp4|wav|ogg|flac)$/i.test(name)
  )
    throw new Error("Выберите аудиофайл: WAV, MP3, M4A, WebM, OGG или FLAC.");
}

export function normalizeAudio(audio: Blob): Blob {
  if (audio.type.startsWith("audio/") || !(audio instanceof File)) return audio;
  const extension = audio.name.split(".").at(-1)?.toLowerCase() ?? "";
  const types: Record<string, string> = {
    wav: "audio/wav",
    mp3: "audio/mpeg",
    m4a: "audio/mp4",
    mp4: "audio/mp4",
    webm: "audio/webm",
    ogg: "audio/ogg",
    flac: "audio/flac",
  };
  return types[extension]
    ? new File([audio], audio.name, { type: types[extension] })
    : audio;
}

export function canRecordAudio() {
  return (
    window.isSecureContext &&
    !!navigator.mediaDevices?.getUserMedia &&
    typeof MediaRecorder !== "undefined"
  );
}

type Options = {
  isActive(): boolean;
  transcribe(audio: Blob, signal: AbortSignal): Promise<{ text: string }>;
  insert(text: string, signal: AbortSignal): Promise<unknown> | unknown;
};

// Keep the draft in its original composer. Cancellation, navigation or account
// changes abort the request and prevent a late response from inserting text.
export async function transcribeAudio(
  audio: Blob,
  options: Options,
  signal: AbortSignal,
) {
  validateAudio(audio, audio instanceof File ? audio.name : "recording.webm");
  audio = normalizeAudio(audio);
  signal.throwIfAborted();
  if (!options.isActive())
    throw new DOMException("Composer changed", "AbortError");
  const attempt = new AbortController();
  const abort = () => attempt.abort(signal.reason);
  signal.addEventListener("abort", abort, { once: true });
  const timeout = setTimeout(
    () =>
      attempt.abort(
        new DOMException(
          "Расшифровка занимает слишком много времени. Попробуйте ещё раз.",
          "TimeoutError",
        ),
      ),
    90_000,
  );
  try {
    const result = await options.transcribe(audio, attempt.signal);
    attempt.signal.throwIfAborted();
    if (!options.isActive())
      throw new DOMException("Composer changed", "AbortError");
    if (typeof result.text !== "string" || !result.text.trim())
      throw new Error("Речь не распознана. Попробуйте другую запись.");
    await options.insert(result.text, attempt.signal);
  } finally {
    clearTimeout(timeout);
    signal.removeEventListener("abort", abort);
  }
}

let activeDialog: HTMLDialogElement | null = null;

export async function openDictation(options: Options): Promise<void> {
  if (activeDialog) {
    activeDialog.focus();
    return;
  }
  if (!options.isActive()) return;
  if (!document.getElementById("codex-web-dictation-styles")) {
    const style = document.createElement("style");
    style.id = "codex-web-dictation-styles";
    style.textContent = styles;
    document.head.append(style);
  }
  const previousFocus = document.activeElement as HTMLElement | null;
  const dialog = document.createElement("dialog");
  dialog.className = "codex-web-dictation";
  dialog.setAttribute("aria-labelledby", "web-dictation-title");
  dialog.innerHTML = `<header><h2 id="web-dictation-title">Голосовой ввод</h2><button type="button" data-close aria-label="Закрыть голосовой ввод">✕</button></header>
    <p data-hint></p><div class="web-dictation-actions"><button type="button" data-record>Записать голос</button><button type="button" data-choose>Выбрать аудиофайл</button></div>
    <input type="file" accept="${AUDIO_ACCEPT}" hidden>
    <p data-status role="status" aria-live="polite"></p>
    <audio controls hidden preload="metadata"></audio>
    <a data-download hidden>Сохранить запись</a>
    <p data-error role="alert" hidden></p>
    <p class="web-dictation-note">При расшифровке аудио отправляется в OpenAI через вашу учётную запись Codex. Текст появится в поле сообщения — без отправки в чат.</p>
    <footer><button type="button" data-cancel>Отмена</button><button type="button" data-transcribe disabled>Расшифровать</button></footer>`;
  const get = <T extends HTMLElement>(selector: string) =>
    dialog.querySelector<T>(selector)!;
  const record = get<HTMLButtonElement>("[data-record]");
  const choose = get<HTMLButtonElement>("[data-choose]");
  const transcribe = get<HTMLButtonElement>("[data-transcribe]");
  const input = get<HTMLInputElement>("input");
  const player = get<HTMLAudioElement>("audio");
  const download = get<HTMLAnchorElement>("[data-download]");
  const status = get<HTMLElement>("[data-status]");
  const error = get<HTMLElement>("[data-error]");
  get("[data-hint]").textContent = canRecordAudio()
    ? "Запишите речь или выберите готовое аудио. Запись — до 5 минут, файл — до 20 МБ."
    : "Для записи микрофона откройте сайт через HTTPS (на этом ПК также подходит localhost). Сейчас можно выбрать файл из диктофона телефона.";
  record.disabled = !canRecordAudio();
  const controller = new AbortController();
  let recording: MediaRecorder | null = null;
  let stream: MediaStream | null = null;
  let audio: Blob | null = null;
  let url: string | null = null;
  let timer: ReturnType<typeof setInterval> | undefined;
  let closed = false;
  let starting = false;
  let busy = false;
  const stopTracks = () => {
    stream?.getTracks().forEach((track) => track.stop());
    stream = null;
  };
  const showError = (reason: unknown) => {
    const name = reason instanceof Error ? reason.name : "";
    error.textContent =
      name === "NotAllowedError"
        ? "Доступ к микрофону не разрешён. Разрешите его в браузере или выберите аудиофайл."
        : name === "NotFoundError"
          ? "Микрофон не найден. Подключите его или выберите аудиофайл."
          : name === "NotReadableError"
            ? "Микрофон занят или недоступен. Освободите его и повторите запись."
            : reason instanceof Error
              ? reason.message
              : "Не удалось обработать аудио. Попробуйте ещё раз.";
    error.hidden = false;
  };
  const setAudio = (value: Blob, name: string) => {
    validateAudio(value, name);
    if (url) URL.revokeObjectURL(url);
    audio = value;
    url = URL.createObjectURL(value);
    player.src = url;
    player.hidden = false;
    download.href = url;
    download.download = name;
    download.hidden = false;
    transcribe.disabled = false;
    status.textContent = `${name} · ${(value.size / 1024 / 1024).toFixed(1)} МБ`;
    error.hidden = true;
  };
  const stopRecording = () => {
    clearInterval(timer);
    if (recording?.state === "recording") recording.stop();
    stopTracks();
  };
  const finished = new Promise<void>((resolve) => {
    const close = () => {
      if (closed) return;
      closed = true;
      controller.abort();
      stopRecording();
      clearInterval(watch);
      window.removeEventListener("popstate", close);
      window.removeEventListener("pagehide", close);
      player.pause();
      player.removeAttribute("src");
      if (url) URL.revokeObjectURL(url);
      activeDialog = null;
      dialog.close();
      dialog.remove();
      if (previousFocus?.isConnected)
        previousFocus.focus({ preventScroll: true });
      resolve();
    };
    const watch = setInterval(() => {
      if (!options.isActive()) close();
    }, 500);
    dialog.addEventListener("cancel", (event) => {
      event.preventDefault();
      close();
    });
    get("[data-close]").onclick = close;
    get("[data-cancel]").onclick = close;
    window.addEventListener("popstate", close);
    window.addEventListener("pagehide", close);
    choose.onclick = () => input.click();
    input.onchange = () => {
      if (closed || busy || starting || recording) return;
      const file = input.files?.[0];
      if (file)
        try {
          setAudio(file, file.name);
        } catch (reason) {
          showError(reason);
        }
      input.value = "";
    };
    record.onclick = async () => {
      if (recording) {
        stopRecording();
        return;
      }
      if (closed || starting || busy || !canRecordAudio()) return;
      starting = true;
      choose.disabled = transcribe.disabled = record.disabled = true;
      error.hidden = true;
      status.textContent = "Ожидание разрешения микрофона…";
      try {
        const acquired = await navigator.mediaDevices.getUserMedia({
          audio: true,
        });
        if (closed || !options.isActive()) {
          acquired.getTracks().forEach((track) => track.stop());
          return;
        }
        stream = acquired;
        const mimeType = [
          "audio/webm;codecs=opus",
          "audio/mp4",
          "audio/webm",
          "audio/ogg;codecs=opus",
        ].find((type) => MediaRecorder.isTypeSupported(type));
        const recorder = new MediaRecorder(
          stream,
          mimeType ? { mimeType } : undefined,
        );
        recording = recorder;
        const chunks: Blob[] = [];
        let bytes = 0;
        let failed = false;
        recorder.ondataavailable = (event) => {
          if (closed || failed || !event.data.size) return;
          chunks.push(event.data);
          bytes += event.data.size;
          if (bytes > MAX_AUDIO_BYTES) {
            failed = true;
            stopRecording();
            showError(
              new Error(
                "Запись превысила 20 МБ. Запишите более короткий фрагмент.",
              ),
            );
          }
        };
        recorder.onerror = () => {
          failed = true;
          stopRecording();
          showError(new Error("Запись прервалась. Попробуйте ещё раз."));
        };
        recorder.onstop = () => {
          stopTracks();
          clearInterval(timer);
          recording = null;
          if (closed) return;
          record.textContent = "Записать заново";
          record.disabled = choose.disabled = false;
          if (!failed)
            try {
              const type = recorder.mimeType || chunks[0]?.type || "audio/webm";
              setAudio(
                new Blob(chunks, { type }),
                `voice.${type.includes("mp4") ? "m4a" : type.includes("ogg") ? "ogg" : "webm"}`,
              );
            } catch (reason) {
              showError(reason);
            }
          transcribe.disabled = !audio;
        };
        recorder.start(1000);
        record.textContent = "Остановить запись";
        record.disabled = false;
        const started = Date.now();
        const tick = () => {
          const elapsed = Date.now() - started;
          status.textContent = `Запись · ${Math.floor(elapsed / 60000)}:${String(Math.floor(elapsed / 1000) % 60).padStart(2, "0")}`;
          if (elapsed >= MAX_RECORDING_MS) stopRecording();
        };
        tick();
        timer = setInterval(tick, 250);
      } catch (reason) {
        stopTracks();
        recording = null;
        if (!closed) {
          showError(reason);
          record.disabled = choose.disabled = false;
          transcribe.disabled = !audio;
          status.textContent = "Запись не началась.";
        }
      } finally {
        starting = false;
      }
    };
    transcribe.onclick = async () => {
      if (!audio || busy || closed || recording || starting) return;
      busy = true;
      player.pause();
      transcribe.disabled = choose.disabled = record.disabled = true;
      status.textContent = "Расшифровываем запись…";
      error.hidden = true;
      try {
        await transcribeAudio(audio, options, controller.signal);
        close();
      } catch (reason) {
        if (!closed) {
          showError(reason);
          status.textContent =
            "Запись сохранена здесь. Можно повторить расшифровку или скачать её.";
        }
      } finally {
        busy = false;
        if (!closed) {
          transcribe.disabled = choose.disabled = false;
          record.disabled = !canRecordAudio();
        }
      }
    };
  });
  activeDialog = dialog;
  document.body.append(dialog);
  dialog.showModal();
  return finished;
}
