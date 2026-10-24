/**
 * The review form's behaviour (components/product/ReviewForm.astro).
 *
 * Step 1 proves the purchase (`/api/review-eligibility`); step 2 rates,
 * writes or records, and sends files. Each file goes to `/api/review-upload`
 * the moment it is added — a photo shrunk in the browser first — with its
 * progress shown and a retry on a dropped connection, so the final submit
 * (`/api/submit-review`) only names what already arrived. Every rule (who may
 * review, the limits, what is kept) is the server's; this script only shows
 * them. All text comes rendered from the component.
 */
import { canRecordVoice, createVoiceRecorder, prepareReviewPhoto, type VoiceRecorder } from "@wocart/storefront/review-media";
import type { ReviewEligibility, ReviewableProduct } from "@wocart/storefront";
import { embeddedMessage } from "@/theme/content/messages";
import { onEachPage } from "@wocart/theme/lifecycle";

type Copy = Record<string, string>;
type FileItem = {
  key: string;
  kind: "image" | "audio";
  node: HTMLLIElement;
  blob: Blob | null;
  durationMs?: number;
  uploadId: string | null;
  state: "preparing" | "sending" | "sent" | "failed";
  cancel?: () => void;
};

const ATTEMPTS = 3;

/** Why the server refused, as the copy says it. */
function refusal(copy: Copy, code: unknown): string {
  switch (code) {
    case "ORDER_NOT_FOUND":
      return copy.errorInvalidOrder;
    case "REVIEW_ORDER_NOT_DELIVERED":
      return copy.errorNotDelivered;
    case "REVIEW_RATE_LIMITED":
      return copy.errorRateLimited;
    case "ORDER_ALREADY_REVIEWED":
      return copy.errorDuplicate;
    case "INVALID_FILE_TYPE":
      return copy.errorFileType;
    case "FILE_TOO_LARGE":
      return copy.errorFileTooLarge;
    default:
      return copy.errorGeneric;
  }
}

async function postJson(url: string, body: unknown): Promise<{ ok: boolean; status: number; json: Record<string, any> }> {
  const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  let json: Record<string, any> = {};
  try {
    json = await response.json();
  } catch {
    json = {};
  }
  return { ok: response.ok, status: response.status, json };
}

/** One upload attempt, with its progress; resolves with the server's answer. */
function put(blob: Blob, headers: Record<string, string>, onProgress: (share: number) => void, register: (abort: () => void) => void) {
  return new Promise<{ status: number; json: Record<string, any> }>((resolve) => {
    const request = new XMLHttpRequest();
    request.open("PUT", "/api/review-upload");
    for (const [name, value] of Object.entries(headers)) request.setRequestHeader(name, value);
    request.upload.onprogress = (event) => event.lengthComputable && onProgress(event.loaded / event.total);
    request.onload = () => {
      let json: Record<string, any> = {};
      try {
        json = JSON.parse(request.responseText);
      } catch {
        json = {};
      }
      resolve({ status: request.status, json });
    };
    request.onerror = () => resolve({ status: 0, json: {} });
    request.ontimeout = () => resolve({ status: 0, json: {} });
    register(() => request.abort());
    request.send(blob);
  });
}

function initReviewForm(): void | (() => void) {
  const root = document.querySelector<HTMLElement>("[data-review-form]");
  if (!root) return;
  const copy: Copy = JSON.parse(root.dataset.copy ?? "{}");
  const $ = <T extends Element>(selector: string) => root.querySelector<T>(selector)!;

  const find = $<HTMLFormElement>("[data-review-find]");
  const write = $<HTMLFormElement>("[data-review-write]");
  const errorWrap = $<HTMLElement>("[data-review-error-wrap]");
  const errorText = $<HTMLElement>("[data-review-error]");
  const success = $<HTMLElement>("[data-review-success]");
  const photoList = $<HTMLUListElement>("[data-photo-list]");
  const voiceList = $<HTMLUListElement>("[data-voice-list]");
  const fileTemplate = $<HTMLTemplateElement>("[data-file-item]");
  const recordButton = $<HTMLButtonElement>("[data-voice-record]");
  const stopButton = $<HTMLButtonElement>("[data-voice-stop]");
  const timer = $<HTMLElement>("[data-voice-timer]");

  let proof: { orderNumber: string; phone: string } | null = null;
  let opened: ReviewEligibility | null = null;
  let rating = 0;
  let files: FileItem[] = [];
  let recorder: VoiceRecorder | null = null;

  const showError = (message: string) => {
    errorText.textContent = message;
    errorWrap.hidden = false;
    errorWrap.scrollIntoView({ behavior: "smooth", block: "nearest" });
  };
  const clearError = () => {
    errorWrap.hidden = true;
    errorText.textContent = "";
  };
  const busy = (button: HTMLButtonElement, on: boolean) => {
    button.disabled = on;
    button.toggleAttribute("aria-busy", on);
  };

  // ── Step 1 ────────────────────────────────────────────────────────────────

  const onFind = async (event: Event) => {
    event.preventDefault();
    clearError();
    const data = new FormData(find);
    const orderNumber = String(data.get("orderNumber") ?? "").trim();
    const phone = String(data.get("phone") ?? "").trim();
    if (!orderNumber || !phone) return showError(copy.errorInvalidOrder);
    const button = $<HTMLButtonElement>("[data-find-button]");
    busy(button, true);
    try {
      const answer = await postJson("/api/review-eligibility", { orderNumber, phone });
      if (!answer.ok) return showError(refusal(copy, answer.json.code));
      const eligibility = answer.json.data as ReviewEligibility;
      if (!eligibility.products.some((product) => !product.reviewed)) return showError(copy.nothingLeft);
      proof = { orderNumber, phone };
      opened = eligibility;
      openWriting(eligibility);
    } catch {
      showError(copy.errorGeneric);
    } finally {
      busy(button, false);
    }
  };

  function openWriting(eligibility: ReviewEligibility) {
    $<HTMLElement>("[data-order-label]").textContent = embeddedMessage(root!.dataset.orderFound, "reviewFormOrderFound", { order: eligibility.orderNumber });
    renderProducts(eligibility.products);
    const media = eligibility.media;
    $<HTMLElement>("[data-photos-block]").hidden = !media || media.maxPhotos === 0;
    $<HTMLElement>("[data-voice-block]").hidden = !media || media.voiceMaxSeconds === null;
    if (media?.maxPhotos) $<HTMLElement>("[data-photos-limit]").textContent = embeddedMessage(root!.dataset.photosHint, "reviewFormPhotosHint", { count: media.maxPhotos });
    if (media?.voiceMaxSeconds) {
      $<HTMLElement>("[data-voice-limit]").textContent = embeddedMessage(root!.dataset.voiceHint, "reviewFormVoiceHint", { count: media.voiceMaxSeconds });
      recordButton.hidden = !canRecordVoice();
    }
    find.hidden = true;
    write.hidden = false;
    write.querySelector<HTMLElement>("[data-star]")?.focus();
  }

  function renderProducts(products: ReviewableProduct[]) {
    const choice = $<HTMLFieldSetElement>("[data-product-choice]");
    const holder = $<HTMLElement>("[data-products]");
    const template = $<HTMLTemplateElement>("[data-product-option]");
    holder.replaceChildren();
    const here = root!.dataset.productId;
    const preferred = products.find((product) => product.productId === here && !product.reviewed) ?? products.find((product) => !product.reviewed);
    for (const product of products) {
      const option = template.content.firstElementChild!.cloneNode(true) as HTMLLabelElement;
      const input = option.querySelector("input")!;
      input.value = product.productId;
      input.disabled = product.reviewed;
      input.checked = product.productId === preferred?.productId;
      option.querySelector<HTMLElement>("[data-name]")!.textContent = product.name;
      option.querySelector<HTMLElement>("[data-reviewed]")!.hidden = !product.reviewed;
      const image = option.querySelector("img")!;
      if (product.imageSrc && /^(https?:)?\//.test(product.imageSrc)) {
        image.src = product.imageSrc;
        image.hidden = false;
      }
      holder.append(option);
    }
    choice.hidden = products.length < 2;
  }

  const onChangeOrder = () => {
    for (const item of files) item.cancel?.();
    recorder?.cancel();
    files = [];
    photoList.replaceChildren();
    voiceList.replaceChildren();
    proof = null;
    opened = null;
    write.hidden = true;
    find.hidden = false;
    clearError();
  };

  // ── Rating ────────────────────────────────────────────────────────────────

  const stars = Array.from(root.querySelectorAll<HTMLButtonElement>("[data-star]"));
  const paint = (value: number) =>
    stars.forEach((star) => {
      const on = Number(star.dataset.star) <= value;
      star.querySelector(".star-icon")?.classList.toggle("text-ink", on);
      star.querySelector(".star-icon")?.classList.toggle("text-border", !on);
    });
  const onStar = (event: Event) => {
    const star = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-star]");
    if (!star) return;
    rating = Number(star.dataset.star);
    stars.forEach((other) => other.setAttribute("aria-checked", String(other === star)));
    paint(rating);
  };

  // ── Files ─────────────────────────────────────────────────────────────────

  const hasVoice = () => files.some((item) => item.kind === "audio" && item.state === "sent");
  const updateBodyHint = () => {
    $<HTMLElement>("[data-body-hint]").hidden = !files.some((item) => item.kind === "audio");
  };

  function addItem(kind: FileItem["kind"], blobOrFile: Blob, durationMs?: number) {
    const node = fileTemplate.content.firstElementChild!.cloneNode(true) as HTMLLIElement;
    const item: FileItem = { key: crypto.randomUUID(), kind, node, blob: null, durationMs, uploadId: null, state: "preparing" };
    const preview = URL.createObjectURL(blobOrFile);
    if (kind === "image") {
      const image = node.querySelector("img")!;
      image.src = preview;
      image.hidden = false;
    } else {
      const audio = node.querySelector("audio")!;
      audio.src = preview;
      audio.hidden = false;
      audio.setAttribute("aria-label", copy.voiceLabel);
    }
    node.querySelector<HTMLButtonElement>("[data-remove]")!.addEventListener("click", () => {
      item.cancel?.();
      URL.revokeObjectURL(preview);
      node.remove();
      files = files.filter((other) => other !== item);
      updateBodyHint();
    });
    node.querySelector<HTMLButtonElement>("[data-retry]")!.addEventListener("click", () => void send(item));
    files.push(item);
    (kind === "image" ? photoList : voiceList).append(node);
    updateBodyHint();
    void (async () => {
      item.blob = kind === "image" ? await prepareReviewPhoto(blobOrFile) : blobOrFile;
      await send(item);
    })();
  }

  function show(item: FileItem, state: FileItem["state"], progress = 0, message?: string) {
    item.state = state;
    const status = item.node.querySelector<HTMLElement>("[data-status]")!;
    status.textContent = state === "sending" || state === "preparing" ? copy.sending : state === "failed" ? message ?? copy.notSent : "";
    item.node.querySelector<HTMLElement>("[data-progress]")!.style.inlineSize = `${Math.round((state === "sent" ? 1 : progress) * 100)}%`;
    item.node.querySelector<HTMLElement>("[data-retry]")!.hidden = state !== "failed";
  }

  async function send(item: FileItem) {
    if (!item.blob || !opened?.media) return;
    show(item, "sending");
    const headers: Record<string, string> = { "Content-Type": "application/octet-stream", "X-Review-Grant": opened.media.grant };
    if (item.durationMs) headers["X-Media-Duration-Ms"] = String(Math.round(item.durationMs));
    for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
      let aborted = false;
      const answer = await put(item.blob, headers, (share) => show(item, "sending", share), (abort) => {
        item.cancel = () => {
          aborted = true;
          abort();
        };
      });
      if (aborted || !files.includes(item)) return;
      if (answer.status === 201) {
        item.uploadId = answer.json.data?.uploadId ?? null;
        return show(item, item.uploadId ? "sent" : "failed");
      }
      const transient = answer.status === 0 || answer.status >= 500;
      if (!transient || attempt === ATTEMPTS) return show(item, "failed", 0, refusal(copy, answer.json.code));
      await new Promise((resolve) => setTimeout(resolve, 1000 * 2 ** attempt));
    }
  }

  const onPhotos = (event: Event) => {
    const input = event.target as HTMLInputElement;
    const max = opened?.media?.maxPhotos ?? 0;
    const room = max - files.filter((item) => item.kind === "image").length;
    const picked = Array.from(input.files ?? []).filter((file) => file.type.startsWith("image/"));
    if (picked.length > room) showError(embeddedMessage(root!.dataset.tooMany, "reviewFormErrorTooManyPhotos", { count: max }));
    for (const file of picked.slice(0, Math.max(room, 0))) addItem("image", file);
    input.value = "";
  };

  const replaceVoice = (blob: Blob, durationMs?: number) => {
    for (const item of files.filter((other) => other.kind === "audio")) item.node.querySelector<HTMLButtonElement>("[data-remove]")!.click();
    addItem("audio", blob, durationMs);
  };

  const onVoiceFile = (event: Event) => {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (file) replaceVoice(file);
    input.value = "";
  };

  const onRecord = async () => {
    const max = opened?.media?.voiceMaxSeconds;
    if (!max) return;
    recorder = createVoiceRecorder({
      maxSeconds: max,
      onTick: (elapsed) => {
        const seconds = Math.floor(elapsed / 1000);
        timer.textContent = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
      },
      onLimit: (voice) => finishRecording(voice.blob, voice.durationMs),
    });
    try {
      await recorder.start();
      recordButton.hidden = true;
      stopButton.hidden = false;
      stopButton.title = copy.recording;
      timer.textContent = "0:00";
    } catch {
      recorder = null;
      showError(copy.voiceDenied);
    }
  };

  const finishRecording = (blob: Blob, durationMs: number) => {
    recorder = null;
    stopButton.hidden = true;
    recordButton.hidden = false;
    replaceVoice(blob, durationMs);
  };

  const onStop = async () => {
    if (!recorder || recorder.state !== "recording") return;
    const voice = await recorder.stop();
    finishRecording(voice.blob, voice.durationMs);
  };

  // ── Submit ────────────────────────────────────────────────────────────────

  const onSubmit = async (event: Event) => {
    event.preventDefault();
    clearError();
    if (!proof || !opened) return;
    const productId = new FormData(write).get("productId")?.toString() ?? opened.products.find((product) => !product.reviewed)?.productId;
    if (!rating) return showError(copy.ratingRequired);
    const body = $<HTMLTextAreaElement>("#review-body").value.trim();
    if (body.length < 10 && !hasVoice()) return showError(copy.minLength);
    if (files.some((item) => item.state !== "sent")) return showError(copy.waitUploads);
    const button = $<HTMLButtonElement>("[data-submit-button]");
    busy(button, true);
    try {
      const title = $<HTMLInputElement>("#review-title").value.trim();
      const answer = await postJson("/api/submit-review", {
        ...proof,
        productId,
        rating,
        body,
        ...(title ? { title } : {}),
        ...(files.length ? { grant: opened.media?.grant, uploads: files.map((item) => item.uploadId) } : {}),
      });
      if (!answer.ok) return showError(refusal(copy, answer.json.code));
      $<HTMLElement>("[data-success-text]").textContent = answer.json.data?.visibility === "published" ? copy.successPublished : copy.successPending;
      write.hidden = true;
      success.hidden = false;
      success.scrollIntoView({ behavior: "smooth", block: "nearest" });
    } catch {
      showError(copy.errorGeneric);
    } finally {
      busy(button, false);
    }
  };

  const listeners: Array<[EventTarget, string, EventListener]> = [
    [find, "submit", onFind],
    [write, "submit", onSubmit],
    [$("[data-change-order]"), "click", onChangeOrder],
    [$("[data-stars]"), "click", onStar],
    [$("[data-photo-file]"), "change", onPhotos],
    [$("[data-voice-file]"), "change", onVoiceFile],
    [recordButton, "click", onRecord],
    [stopButton, "click", onStop],
  ];
  for (const [target, type, listener] of listeners) target.addEventListener(type, listener);
  return () => {
    for (const [target, type, listener] of listeners) target.removeEventListener(type, listener);
    for (const item of files) item.cancel?.();
    recorder?.cancel();
  };
}

onEachPage(initReviewForm);
