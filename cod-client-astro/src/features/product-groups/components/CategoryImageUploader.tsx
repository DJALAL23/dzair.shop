import { useRef, useState } from "react";
import { Loader2, UploadCloud, X } from "lucide-react";
import { ACCEPTED_IMAGE_TYPES, MAX_UPLOAD_MB, partitionUploadFiles, uploadFailure, type MediaImage } from "@/features/uploads/api";
import { useImageUpload } from "@/features/uploads/useImageUpload";
import { useT } from "@/i18n/react";
import { notify } from "@/lib/notify";

export function CategoryImageUploader({ value, onChange, disabled }: { value: MediaImage | null; onChange: (image: MediaImage | null) => void; disabled?: boolean }) {
  const common = useT("common");
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const { upload, progress } = useImageUpload("products");
  const uploading = progress !== null;

  async function handleFile(file: File) {
    const { accepted, unsupportedCount, tooLargeCount } = partitionUploadFiles([file]);
    if (unsupportedCount > 0) {
      notify.error(common("feedback.unsupported_file"));
      return;
    }
    if (tooLargeCount > 0) {
      notify.error(common("feedback.file_too_large"));
      return;
    }
    try {
      onChange(await upload(accepted[0]));
      notify.success(common("feedback.uploaded"));
    } catch (cause) {
      notify.error(common(`feedback.${uploadFailure(cause)}`));
    }
  }

  return <div className="space-y-4">
    {value && <div className="group relative aspect-video max-w-md overflow-hidden rounded-xl border border-border bg-muted shadow-sm">
      <img src={value.url} alt={common("image.category_alt")} className="size-full object-cover" />
      <div className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 transition-opacity group-hover:opacity-100">
        <button type="button" disabled={disabled} onClick={() => onChange(null)} className="grid size-10 place-items-center rounded-full bg-destructive text-white hover:bg-destructive/80 disabled:opacity-50" aria-label={common("image.remove")}><X size={20} /></button>
      </div>
    </div>}
    {!value && <div
      onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={(event) => { event.preventDefault(); setDragging(false); if (disabled || uploading) return; const file = event.dataTransfer.files[0]; if (file) void handleFile(file); }}
      onClick={() => !disabled && !uploading && inputRef.current?.click()}
      className={`flex cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed px-6 py-12 transition-all ${dragging ? "scale-[1.01] border-primary bg-primary/5" : "border-border/50 hover:border-primary/50 hover:bg-muted/30"} ${disabled || uploading ? "pointer-events-none cursor-not-allowed opacity-50" : ""}`}
    >
      {uploading ? <Loader2 size={40} className="animate-spin text-primary" /> : <span className="grid size-14 place-items-center rounded-xl bg-primary/10"><UploadCloud size={28} className="text-primary" /></span>}
      <div className="text-center">
        <p className="text-sm font-semibold text-foreground">{uploading ? common("image.uploading") : dragging ? common("image.drop_image") : common("image.pick_image")}</p>
        <p className="mt-1 text-xs text-muted-foreground">{common("image.formats", { mb: MAX_UPLOAD_MB })}</p>
      </div>
      <input ref={inputRef} type="file" accept={ACCEPTED_IMAGE_TYPES.join(",")} className="hidden" onChange={(event) => event.currentTarget.files?.[0] && void handleFile(event.currentTarget.files[0])} disabled={disabled || uploading} />
    </div>}
  </div>;
}
