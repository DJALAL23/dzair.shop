/**
 * The review voice notes' player. One note plays at a time: starting one pauses
 * the others. Each player shows its position on the track and in the time, and
 * a seek moves within the note. The controls are plain markup
 * (components/product/VoicePlayer.astro); this binds them.
 *
 * Bound by delegation on the document, so the notes of reviews loaded later
 * (the list's "load more") work without a second binding. Media events do not
 * bubble, so they are listened to in the capture phase.
 */
import { formatClock } from "../utils/clock";

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
  const seek = player.querySelector<HTMLInputElement>("[data-voice-seek]");
  const time = player.querySelector<HTMLElement>("[data-voice-time]");
  const share = length > 0 ? Math.min(1, audio.currentTime / length) : 0;
  if (seek) seek.value = String(Math.round(share * 1000));
  player.style.setProperty("--p", String(Math.round(share * 100)));
  if (time) time.textContent = `${formatClock(audio.currentTime * 1000)} / ${formatClock(length * 1000)}`;
}

function setPlaying(player: HTMLElement, playing: boolean): void {
  player.classList.toggle("is-playing", playing);
  const toggle = player.querySelector<HTMLButtonElement>("[data-voice-toggle]");
  const label = playing ? player.dataset.pauseLabel : player.dataset.playLabel;
  if (toggle && label) toggle.setAttribute("aria-label", label);
}

export function initVoicePlayers(root: Document): () => void {
  const playerOf = (node: EventTarget | null): HTMLElement | null =>
    node instanceof Element ? node.closest<HTMLElement>("[data-voice]") : null;

  const onClick = (event: Event) => {
    const toggle = event.target instanceof Element ? event.target.closest("[data-voice-toggle]") : null;
    if (!toggle) return;
    const player = playerOf(toggle);
    const audio = player?.querySelector<HTMLAudioElement>("[data-voice-audio]");
    if (!player || !audio) return;
    if (!audio.paused) {
      audio.pause();
      return;
    }
    for (const other of root.querySelectorAll<HTMLAudioElement>("[data-voice-audio]")) {
      if (other !== audio && !other.paused) other.pause();
    }
    void audio.play().catch(() => undefined);
  };

  const onSeek = (event: Event) => {
    const seek = event.target instanceof HTMLInputElement && event.target.matches("[data-voice-seek]") ? event.target : null;
    const player = playerOf(seek);
    const audio = player?.querySelector<HTMLAudioElement>("[data-voice-audio]");
    if (!player || !audio || !seek) return;
    const length = lengthOf(player, audio);
    if (length > 0) audio.currentTime = (Number(seek.value) / 1000) * length;
    showPosition(player, audio);
  };

  const onPlay = (event: Event) => {
    const audio = event.target instanceof HTMLAudioElement ? event.target : null;
    const player = playerOf(audio);
    if (player) setPlaying(player, true);
  };

  const onPause = (event: Event) => {
    const audio = event.target instanceof HTMLAudioElement ? event.target : null;
    const player = playerOf(audio);
    if (player && audio) setPlaying(player, false);
    if (player && audio) showPosition(player, audio);
  };

  const onEnded = (event: Event) => {
    const audio = event.target instanceof HTMLAudioElement ? event.target : null;
    const player = playerOf(audio);
    if (!player || !audio) return;
    audio.currentTime = 0;
    setPlaying(player, false);
    showPosition(player, audio);
  };

  const onTime = (event: Event) => {
    const audio = event.target instanceof HTMLAudioElement ? event.target : null;
    const player = playerOf(audio);
    if (player && audio) showPosition(player, audio);
  };

  root.addEventListener("click", onClick);
  root.addEventListener("input", onSeek);
  root.addEventListener("play", onPlay, true);
  root.addEventListener("pause", onPause, true);
  root.addEventListener("ended", onEnded, true);
  root.addEventListener("timeupdate", onTime, true);

  return () => {
    root.removeEventListener("click", onClick);
    root.removeEventListener("input", onSeek);
    root.removeEventListener("play", onPlay, true);
    root.removeEventListener("pause", onPause, true);
    root.removeEventListener("ended", onEnded, true);
    root.removeEventListener("timeupdate", onTime, true);
  };
}
