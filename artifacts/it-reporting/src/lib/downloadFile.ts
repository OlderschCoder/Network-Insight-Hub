import { authFetch } from "./authFetch";

function safeFilename(value: string): string | null {
  const basename = value.trim().replace(/^['"]|['"]$/g, "").split(/[\\/]/).pop()?.trim();
  return basename ? basename.replace(/[\u0000-\u001f\u007f]/g, "") : null;
}

export function filenameFromContentDisposition(value: string | null): string | null {
  if (!value) return null;
  const encoded = /filename\*\s*=\s*UTF-8''([^;]+)/i.exec(value)?.[1];
  if (encoded) {
    try {
      return safeFilename(decodeURIComponent(encoded));
    } catch {
      return safeFilename(encoded);
    }
  }
  const quoted = /filename\s*=\s*"([^"]+)"/i.exec(value)?.[1];
  if (quoted) return safeFilename(quoted);
  const plain = /filename\s*=\s*([^;]+)/i.exec(value)?.[1];
  return plain ? safeFilename(plain) : null;
}

async function responseError(response: Response): Promise<string> {
  const fallback = `Export failed (${response.status})`;
  try {
    const contentType = response.headers.get("content-type") || "";
    if (contentType.includes("application/json")) {
      const body = await response.json() as { error?: string; message?: string };
      const detail = body.message || body.error;
      return detail ? `${fallback}: ${detail}` : fallback;
    }
    const detail = (await response.text()).replace(/\s+/g, " ").trim().slice(0, 300);
    return detail ? `${fallback}: ${detail}` : fallback;
  } catch {
    return fallback;
  }
}

/** Authenticated download path for every PDF, Word, and spreadsheet export. */
export async function downloadAuthenticatedFile(
  input: string,
  fallbackFilename: string,
  init: RequestInit = {},
): Promise<string> {
  const response = await authFetch(input, { credentials: "include", ...init });
  if (!response.ok) throw new Error(await responseError(response));

  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    throw new Error("Export returned JSON instead of a document.");
  }

  const blob = await response.blob();
  if (blob.size === 0) throw new Error("Export returned an empty document.");

  const filename = filenameFromContentDisposition(response.headers.get("content-disposition")) || fallbackFilename;
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = filename;
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  window.setTimeout(() => {
    anchor.remove();
    URL.revokeObjectURL(objectUrl);
  }, 1000);
  return filename;
}
