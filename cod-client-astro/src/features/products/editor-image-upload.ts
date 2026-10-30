import type { UploadFunction } from "@/components/tiptap-node/image-upload-node/image-upload-node-extension";
import { uploadFailure, uploadImageFile } from "@/features/uploads/api";
import { editorT } from "@/i18n/editor";
import { notify } from "@/lib/notify";

/**
 * Inline description images go through the dashboard's single upload seam
 * (`features/uploads`), not the template's demo uploader, and return the URL
 * the editor puts in `img src`; the server stores it as `media:<key>`.
 *
 * A failure is said in a toast, then rethrown so the upload node shows its
 * error state.
 */
export const uploadDescriptionImage: UploadFunction = async (file, onProgress) => {
  onProgress?.({ progress: 0 });
  try {
    const uploaded = await uploadImageFile(file, "products");
    onProgress?.({ progress: 100 });
    return uploaded.url;
  } catch (cause) {
    notify.error(editorT(`feedback.${uploadFailure(cause)}`, "common"));
    throw cause;
  }
};
