export type PickFilesOptions = {
  acceptedFileExtensions?: string[];
  allowMultiple?: boolean;
  imagesOnly?: boolean;
  kind?: string;
  pickerTitle?: string;
};

export type PickedFile = { label: string; path: string; fsPath: string };
export type BrowserFilePicker = (
  options?: PickFilesOptions,
) => Promise<PickedFile[]>;

/** Run synchronously up to opening the picker: Android requires the user's tap. */
function openBrowserFilePicker(options: PickFilesOptions): Promise<File[]> {
  return new Promise((resolve, reject) => {
    const input = document.createElement("input");
    let settled = false;
    const cleanup = () => {
      input.removeEventListener("change", changed);
      input.removeEventListener("cancel", cancelled);
      input.remove();
    };
    const finish = (files: File[]) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(files);
    };
    const changed = () => finish(Array.from(input.files ?? []));
    const cancelled = () => finish([]);
    input.type = "file";
    input.multiple = options.allowMultiple ?? true;
    input.tabIndex = -1;
    if (options.imagesOnly) input.accept = "image/*";
    else if (options.acceptedFileExtensions?.length) {
      input.accept = options.acceptedFileExtensions
        .filter((extension) => extension !== "*")
        .map((extension) =>
          extension.startsWith(".") ? extension : `.${extension}`,
        )
        .join(",");
    }
    if (options.kind === "directory") input.webkitdirectory = true;
    Object.assign(input.style, {
      height: "1px",
      width: "1px",
      position: "fixed",
      left: "-9999px",
      top: "0",
      opacity: "0",
    });
    input.addEventListener("change", changed);
    input.addEventListener("cancel", cancelled);
    document.body.append(input);
    try {
      if (typeof input.showPicker === "function") input.showPicker();
      else input.click();
    } catch (error) {
      settled = true;
      cleanup();
      reject(error);
    }
  });
}

/** Return the native AppHost file descriptor contract, with files on this host. */
export const pickBrowserFiles: BrowserFilePicker = async (options = {}) => {
  const files = await openBrowserFilePicker(options);
  if (!files.length) return [];
  const form = new FormData();
  for (const file of files) form.append("files", file, file.name || "upload");
  const response = await fetch(
    new URL("/__backend/upload", window.location.href),
    {
      method: "POST",
      body: form,
    },
  );
  if (!response.ok)
    throw new Error(`Upload failed: ${response.status} ${response.statusText}`);
  const result = await response.json();
  if (
    !Array.isArray(result?.files) ||
    result.files.some(
      (file: PickedFile) =>
        !file ||
        typeof file.label !== "string" ||
        typeof file.path !== "string" ||
        typeof file.fsPath !== "string",
    )
  ) {
    throw new Error("Invalid file upload response");
  }
  return result.files;
};
