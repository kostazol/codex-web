import path from "node:path";

export function resolveLocalFile(
  requestPath: string,
  platform = process.platform,
): string | null {
  if (!requestPath || requestPath.includes("\0")) return null;
  if (platform === "win32") {
    // Browser paths may have a leading slash before the drive letter.
    const value = requestPath.replace(/^\/(?=[a-z]:[/\\])/i, "");
    // Only local drive paths; never trigger SMB/UNC authentication from a URL.
    if (!/^[a-z]:[/\\]/i.test(value) || value.slice(2).includes(":"))
      return null;
    return path.win32.normalize(value);
  }
  const value = requestPath.startsWith("/") ? requestPath : `/${requestPath}`;
  return path.posix.normalize(value);
}
