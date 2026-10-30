import { useCallback, useState } from "react";
import { uploadImageFile } from "./api";
import type { ImageUploadFolder, MediaImage } from "./api";

/** null = idle; 0 while an upload is in flight. Uploads report no byte
 *  progress, so the value returns to null when the upload settles. */
type UploadProgress = number | null;

export function useImageUpload(folder: ImageUploadFolder) {
  const [progress, setProgress] = useState<UploadProgress>(null);

  const upload = useCallback(
    async (file: File): Promise<MediaImage> => {
      setProgress(0);
      try {
        return await uploadImageFile(file, folder);
      } finally {
        setProgress(null);
      }
    },
    [folder],
  );

  return { upload, progress };
}
