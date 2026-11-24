import { imageSize } from "image-size";

export function embeddedImageSize(source: string) {
  const match = /^data:(image\/[a-zA-Z0-9.+-]+)(;base64)?,(.*)$/s.exec(source);
  if (!match || source.length > 28_000_000)
    throw new Error(
      "EMBEDDED_IMAGE_REQUIRED: import remote images through agent_resource_import and bind the cached resource",
    );
  const bytes = match[2]
    ? Buffer.from(match[3], "base64")
    : Buffer.from(decodeURIComponent(match[3]));
  const size = imageSize(bytes);
  if (!size.width || !size.height || size.width * size.height > 40_000_000)
    throw new Error("IMAGE_DIMENSIONS_LIMIT");
  return { width: size.width, height: size.height };
}

/** Only the native content library sees this dimension-only Image adapter.
 * It never opens sockets, decodes pixels, or crosses into the guest JS global. */
export function installHeadlessImageAdapter() {
  if (typeof (globalThis as any).Image !== "undefined") return;
  (globalThis as any).Image = class {
    width = 0;
    height = 0;
    naturalWidth = 0;
    naturalHeight = 0;
    complete = false;
    onload?: () => void;
    onerror?: (error: Error) => void;
    private _src = "";
    set src(value: string) {
      this._src = value;
      queueMicrotask(() => {
        try {
          const size = embeddedImageSize(value);
          Object.assign(this, size, {
            naturalWidth: size.width,
            naturalHeight: size.height,
            complete: true,
          });
          this.onload?.();
        } catch (error) {
          this.onerror?.(
            error instanceof Error ? error : new Error(String(error)),
          );
        }
      });
    }
    get src() {
      return this._src;
    }
    setAttribute() {}
    removeAttribute() {}
  };
}
