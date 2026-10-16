import { useEffect, useRef, useState } from "react";
import { uploadReviewFile } from "@/features/reviews/api";
import { REVIEW_MAX_PHOTOS } from "../../../../../cod-shared/reviews/model";

export interface ReviewFile {
  key: string;
  name: string;
  kind: "image" | "audio";
  /** A local preview of a photo. */
  preview: string | null;
  status: "uploading" | "done" | "error";
  uploadId: string | null;
  error: unknown;
}

/** A voice file's length from its own metadata, when the browser can read it. */
function readDuration(file: File): Promise<number | undefined> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const audio = new Audio();
    const done = (value?: number) => {
      URL.revokeObjectURL(url);
      resolve(value);
    };
    audio.preload = "metadata";
    audio.onloadedmetadata = () => done(Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration * 1000 : undefined);
    audio.onerror = () => done(undefined);
    window.setTimeout(() => done(undefined), 4000);
    audio.src = url;
  });
}

/**
 * The photos and voice note of a review being entered: each sent the moment
 * it is picked, with its own state, retried or removed on its own. Picks past
 * the limits (6 photos, 1 voice note) are left out before any upload.
 */
export function useReviewFiles() {
  const [files, setFiles] = useState<ReviewFile[]>([]);
  const sources = useRef(new Map<string, File>());
  const previews = useRef(new Set<string>());

  useEffect(() => () => previews.current.forEach((url) => URL.revokeObjectURL(url)), []);

  const update = (key: string, patch: Partial<ReviewFile>) => setFiles((current) => current.map((file) => (file.key === key ? { ...file, ...patch } : file)));

  async function send(key: string, file: File, kind: ReviewFile["kind"]) {
    update(key, { status: "uploading", error: null });
    try {
      const duration = kind === "audio" ? await readDuration(file) : undefined;
      const uploaded = await uploadReviewFile(file, duration);
      update(key, { status: "done", uploadId: uploaded.uploadId });
    } catch (error) {
      update(key, { status: "error", error });
    }
  }

  function add(picked: FileList | File[]) {
    let photos = files.filter((file) => file.kind === "image").length;
    let voices = files.filter((file) => file.kind === "audio").length;
    const added: Array<{ entry: ReviewFile; file: File }> = [];
    let skipped = 0;
    for (const file of Array.from(picked)) {
      const kind = file.type.startsWith("audio/") || /\.(opus|ogg|m4a|mp3|webm|aac)$/i.test(file.name) ? "audio" : file.type.startsWith("image/") ? "image" : null;
      if (!kind || (kind === "image" && photos >= REVIEW_MAX_PHOTOS) || (kind === "audio" && voices >= 1)) {
        skipped++;
        continue;
      }
      kind === "image" ? photos++ : voices++;
      const key = crypto.randomUUID();
      sources.current.set(key, file);
      const preview = kind === "image" ? URL.createObjectURL(file) : null;
      if (preview) previews.current.add(preview);
      added.push({ entry: { key, name: file.name, kind, preview, status: "uploading", uploadId: null, error: null }, file });
    }
    setFiles((current) => [...current, ...added.map((item) => item.entry)]);
    for (const { entry, file } of added) void send(entry.key, file, entry.kind);
    return { skipped };
  }

  function retry(key: string) {
    const file = sources.current.get(key);
    const entry = files.find((item) => item.key === key);
    if (file && entry) void send(key, file, entry.kind);
  }

  function remove(key: string) {
    setFiles((current) => {
      const gone = current.find((file) => file.key === key);
      if (gone?.preview) {
        URL.revokeObjectURL(gone.preview);
        previews.current.delete(gone.preview);
      }
      return current.filter((file) => file.key !== key);
    });
    sources.current.delete(key);
  }

  return {
    files,
    add,
    retry,
    remove,
    uploading: files.some((file) => file.status === "uploading"),
    failed: files.some((file) => file.status === "error"),
    uploadIds: files.flatMap((file) => (file.uploadId ? [file.uploadId] : [])),
    hasVoice: files.some((file) => file.kind === "audio" && file.status === "done"),
  };
}
