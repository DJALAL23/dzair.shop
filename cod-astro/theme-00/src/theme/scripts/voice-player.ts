/**
 * The review voice notes' player. One note plays at a time: starting one pauses
 * the others. Each player says what it is doing — waiting, loading, playing,
 * paused, or failed with a retry on the same button — shows its position on
 * the track and in the time, and tells a screen reader the position as words
 * ("0:12 of 0:45"). The track steps a second per arrow key and never mirrors:
 * time runs left to right in every language. The controls are plain markup
 * (components/product/VoicePlayer.astro); this binds them.
 *
 * Bound by delegation on the document, so the notes of reviews loaded later
 * (the list's "load more") work without a second binding. Media events do not
 * bubble, so they are listened to in the capture phase.
 */
import { embeddedTemplate } from "@/theme/content/messages";
import { formatClock } from "../utils/clock";

type VoiceState = "idle" | "loading" | "playing" | "paused" | "error";

/** `HTMLMediaElement.HAVE_FUTURE_DATA`: enough of the note to start playing now. */
const CAN_PLAY = 3;

/**
 * The note's length: the file's own once it has loaded (`preload="none"` leaves
 * it unknown until the first play), otherwise the length the review recorded.
 */
function lengthOf(player: HTMLElement, audio: HTMLAudioElement): number {
  if (Number.isFinite(audio.duration) && audio.duration > 0) return audio.duration;
  const fromData = Number(player.dataset.durationMs ?? 0);
  return fromData > 0 ? fromData / 1000 : 0;
}

function showPosition(player: HTMLElement, audio: HTMLAudioElement): void {
  const length = lengthOf(player, audio);
  const at = length > 0 ? Math.min(audio.currentTime, length) : 0;
  const seek = player.querySelector<HTMLInputElement>("[data-voice-seek]");
  const time = player.querySelector<HTMLElement>("[data-voice-time]");
  const elapsed = formatClock(at * 1000);
  const total = formatClock(length * 1000);
  if (seek) {
    seek.max = String(Math.max(1, Math.round(length)));
    seek.value = String(Math.floor(at));
    seek.disabled = length === 0;
    seek.setAttribute("aria-valuetext", embeddedTemplate(player.dataset.positionLabel ?? "", { elapsed, total }));
  }
  player.style.setProperty("--p", String(length > 0 ? Math.round((at / length) * 100) : 0));
  if (time) time.textContent = `${elapsed} / ${total}`;
}

function setState(player: HTMLElement, state: VoiceState): void {
  player.dataset.state = state;
  player.setAttribute("aria-busy", state === "loading" ? "true" : "false");
  const toggle = player.querySelector<HTMLButtonElement>("[data-voice-toggle]");
  const label = state === "playing" || state === "loading" ? player.dataset.pauseLabel : state === "error" ? player.dataset.retryLabel : player.dataset.playLabel;
  if (toggle && label) toggle.setAttribute("aria-label", label);
  const error = player.querySelector<HTMLElement>("[data-voice-error]");
  if (error) error.textContent = state === "error" ? (player.dataset.errorLabel ?? "") : "";
}

export function initVoicePlayers(root: Document): () => void {
  const playerOf = (node: EventTarget | null): HTMLElement | null =>
    node instanceof Element ? node.closest<HTMLElement>("[data-voice]") : null;
  const audioEvent = (event: Event): { player: HTMLElement; audio: HTMLAudioElement } | null => {
    const audio = event.target instanceof HTMLAudioElement ? event.target : null;
    const player = playerOf(audio);
    return player && audio ? { player, audio } : null;
  };

  const play = (player: HTMLElement, audio: HTMLAudioElement) => {
    for (const other of root.querySelectorAll<HTMLAudioElement>("[data-voice-audio]")) {
      if (other !== audio && !other.paused) other.pause();
    }
    if (player.dataset.state === "error") audio.load();
    if (audio.readyState < CAN_PLAY) setState(player, "loading");
    void audio.play().catch((error: unknown) => {
      if (!(error instanceof DOMException && error.name === "AbortError")) setState(player, "error");
    });
  };

  const onClick = (event: Event) => {
    const toggle = event.target instanceof Element ? event.target.closest("[data-voice-toggle]") : null;
    const player = playerOf(toggle);
    const audio = player?.querySelector<HTMLAudioElement>("[data-voice-audio]");
    if (!player || !audio) return;
    if (audio.paused) play(player, audio);
    else audio.pause();
  };

  const onSeek = (event: Event) => {
    const seek = event.target instanceof HTMLInputElement && event.target.matches("[data-voice-seek]") ? event.target : null;
    const player = playerOf(seek);
    const audio = player?.querySelector<HTMLAudioElement>("[data-voice-audio]");
    if (!player || !audio || !seek) return;
    if (lengthOf(player, audio) > 0) audio.currentTime = Number(seek.value);
    showPosition(player, audio);
  };

  const onFocus = (event: Event) => {
    const player = event.target instanceof HTMLInputElement && event.target.matches("[data-voice-seek]") ? playerOf(event.target) : null;
    const audio = player?.querySelector<HTMLAudioElement>("[data-voice-audio]");
    if (player && audio) showPosition(player, audio);
  };

  const onPlaying = (event: Event) => {
    const found = audioEvent(event);
    if (found) setState(found.player, "playing");
  };

  const onWaiting = (event: Event) => {
    const found = audioEvent(event);
    if (found && !found.audio.paused) setState(found.player, "loading");
  };

  const onPause = (event: Event) => {
    const found = audioEvent(event);
    if (!found || found.player.dataset.state === "error") return;
    setState(found.player, "paused");
    showPosition(found.player, found.audio);
  };

  const onEnded = (event: Event) => {
    const found = audioEvent(event);
    if (!found) return;
    found.audio.currentTime = 0;
    setState(found.player, "idle");
    showPosition(found.player, found.audio);
  };

  const onTime = (event: Event) => {
    const found = audioEvent(event);
    if (found) showPosition(found.player, found.audio);
  };

  const onError = (event: Event) => {
    const found = audioEvent(event);
    if (found && found.audio.getAttribute("src")) setState(found.player, "error");
  };

  const listeners: Array<[string, (event: Event) => void, boolean]> = [
    ["click", onClick, false],
    ["input", onSeek, false],
    ["focusin", onFocus, false],
    ["playing", onPlaying, true],
    ["waiting", onWaiting, true],
    ["pause", onPause, true],
    ["ended", onEnded, true],
    ["timeupdate", onTime, true],
    ["loadedmetadata", onTime, true],
    ["error", onError, true],
  ];
  for (const [type, listener, capture] of listeners) root.addEventListener(type, listener, capture);
  return () => {
    for (const [type, listener, capture] of listeners) root.removeEventListener(type, listener, capture);
  };
}
