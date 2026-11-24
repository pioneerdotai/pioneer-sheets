import { getAppClient } from "../../client/pioneer/client";
import { newId } from "../../shared/id";
import { UniverDrawingPlugin } from "@univerjs/drawing";
import { BehaviorSubject } from "rxjs";
import {
  ImageSourceType,
  ImageUploadStatusType,
  IImageIoService as IImageIoServiceToken,
  type IImageIoService,
} from "@univerjs/core";
import { uploadFile } from "../../client/files";
import { fileSource, parseFileSource } from "../../shared/files";

export function fileImageIo(): IImageIoService {
  const wait = new BehaviorSubject(0),
    cache = new Map<string, HTMLImageElement>(),
    sources = new Map<string, Promise<string>>();
  return {
    change$: wait.asObservable(),
    setWaitCount(n) {
      wait.next(n);
    },
    async getImage(source) {
      const ref = parseFileSource(source);
      if (!ref) return source;
      let found = sources.get(source);
      if (!found) {
        found = (async () => {
          const r = await fetch(
            (await getAppClient()).url(
              "api/files/" + ref.fileId + "/content?version=" + ref.version,
            ),
          );
          if (!r.ok) throw new Error("IMAGE_DOWNLOAD_FAILED");
          const blob = await r.blob();
          return new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result));
            reader.onerror = reject;
            reader.readAsDataURL(blob);
          });
        })();
        sources.set(source, found);
        found.catch(() => sources.delete(source));
      }
      return found;
    },
    async saveImage(file) {
      try {
        if (!/^image\/(png|jpeg|gif|webp|svg\+xml|bmp)$/.test(file.type))
          throw new Error("IMAGE_TYPE_NOT_SUPPORTED");
        const f = await uploadFile(file),
          source = fileSource(f.id, f.version);
        return {
          imageId: newId(),
          imageSourceType: ImageSourceType.UUID,
          source,
          base64Cache: await this.getImage(source),
          status: ImageUploadStatusType.SUCCUSS,
        };
      } finally {
        wait.next(Math.max(0, wait.value - 1));
      }
    },
    getImageSourceCache(source, type) {
      const key = type + source;
      let image = cache.get(key);
      if (image) return image;
      image = new Image();
      cache.set(key, image);
      image.onload = () => wait.next(wait.value);
      image.onerror = () => wait.next(wait.value);
      void this.getImage(source)
        .then((value) => {
          image!.src = value;
        })
        .catch(() => {
          cache.delete(key);
          wait.next(wait.value);
        });
      return image;
    },
    addImageSourceCache(source, type, image) {
      if (image) cache.set(type + source, image);
      else cache.delete(type + source);
    },
  };
}

export function fileDrawingPreset<T>(preset: T): T {
  const entry = (preset as any).plugins.find(
    (p: any) => Array.isArray(p) && p[0] === UniverDrawingPlugin,
  );
  if (!entry) throw new Error("DRAWING_PRESET_NOT_FOUND");
  entry[1] = {
    ...entry[1],
    override: [[IImageIoServiceToken, { useValue: fileImageIo() }]],
  };
  return preset;
}
