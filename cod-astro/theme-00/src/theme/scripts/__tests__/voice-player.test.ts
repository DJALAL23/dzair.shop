/**
 * The review voice player's behaviour.
 *
 * Pins the contract the shopper relies on: starting a note pauses the others,
 * the player says when it is loading, playing or failed (and retries from the
 * same button), the track and the time follow the position, a screen reader
 * hears the position as words, the track moves a second per step, and the
 * note returns to its start when it ends. Bound by delegation, so a card
 * loaded later works without a second binding.
 */
/// <reference types="vitest/globals" />

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initVoicePlayers } from "../voice-player";

function player(id: string, durationMs: number): string {
  return `
    <div class="voice" data-voice id="${id}" data-state="idle" data-duration-ms="${durationMs}" data-play-label="Play" data-pause-label="Pause" data-retry-label="Retry" data-error-label="Could not play." data-position-label="{elapsed} of {total}">
      <audio data-voice-audio preload="none" src="/${id}.webm"></audio>
      <button type="button" data-voice-toggle aria-label="Play">▶</button>
      <input type="range" data-voice-seek min="0" max="1" step="1" value="0" aria-label="Position" />
      <span data-voice-time>0:00 / 0:00</span>
      <span data-voice-error role="status" aria-live="polite"></span>
    </div>`;
}

/** An audio element whose playback the test drives, since the test browser plays nothing. */
function driven(audio: HTMLAudioElement, refuse?: string) {
  let paused = true;
  Object.defineProperty(audio, "paused", { get: () => paused, configurable: true });
  audio.load = vi.fn();
  audio.play = vi.fn(async () => {
    if (refuse) throw new DOMException("refused", refuse);
    paused = false;
    audio.dispatchEvent(new Event("play"));
  });
  audio.pause = vi.fn(() => {
    if (paused) return;
    paused = true;
    audio.dispatchEvent(new Event("pause"));
  });
  return {
    set position(seconds: number) {
      audio.currentTime = seconds;
      audio.dispatchEvent(new Event("timeupdate"));
    },
  };
}

const $ = <T extends Element>(selector: string) => document.querySelector<T>(selector)!;
const state = (id: string) => $<HTMLElement>(`#${id}`).dataset.state;
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

let teardown: () => void;

beforeEach(() => {
  document.body.innerHTML = `<main>${player("a", 12_000)}${player("b", 65_400)}</main>`;
  teardown = initVoicePlayers(document);
});

afterEach(() => {
  teardown();
  document.body.innerHTML = "";
});

describe("the voice player", () => {
  it("loads a note on its toggle, then plays it, and the toggle says it can pause", async () => {
    const audio = $<HTMLAudioElement>("#a [data-voice-audio]");
    driven(audio);
    $<HTMLButtonElement>("#a [data-voice-toggle]").click();
    await flush();
    expect(audio.play).toHaveBeenCalledOnce();
    expect(state("a")).toBe("loading");
    expect($("#a").getAttribute("aria-busy")).toBe("true");
    expect($("#a [data-voice-toggle]").getAttribute("aria-label")).toBe("Pause");
    audio.dispatchEvent(new Event("playing"));
    expect(state("a")).toBe("playing");
    expect($("#a").getAttribute("aria-busy")).toBe("false");
  });

  it("starting one note pauses the note that was playing", async () => {
    const first = $<HTMLAudioElement>("#a [data-voice-audio]");
    const second = $<HTMLAudioElement>("#b [data-voice-audio]");
    driven(first);
    driven(second);
    $<HTMLButtonElement>("#a [data-voice-toggle]").click();
    await flush();
    first.dispatchEvent(new Event("playing"));
    $<HTMLButtonElement>("#b [data-voice-toggle]").click();
    await flush();
    second.dispatchEvent(new Event("playing"));
    expect(first.pause).toHaveBeenCalled();
    expect(state("a")).toBe("paused");
    expect(state("b")).toBe("playing");
  });

  it("follows the position on the track, in the time, and in words for a screen reader", () => {
    const drive = driven($<HTMLAudioElement>("#b [data-voice-audio]"));
    drive.position = 16.35;
    const seek = $<HTMLInputElement>("#b [data-voice-seek]");
    expect($("#b [data-voice-time]").textContent).toBe("0:16 / 1:05");
    expect(seek.max).toBe("65");
    expect(seek.value).toBe("16");
    expect(seek.getAttribute("aria-valuetext")).toBe("0:16 of 1:05");
    expect($<HTMLElement>("#b").style.getPropertyValue("--p")).toBe("25");
  });

  it("a seek moves within the note, a second per step", () => {
    const audio = $<HTMLAudioElement>("#a [data-voice-audio]");
    driven(audio);
    const seek = $<HTMLInputElement>("#a [data-voice-seek]");
    seek.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    expect(seek.max).toBe("12");
    seek.value = "6";
    seek.dispatchEvent(new Event("input", { bubbles: true }));
    expect(audio.currentTime).toBe(6);
  });

  it("measures the track by the file's own length once it has loaded, not the length recorded for it", () => {
    const audio = $<HTMLAudioElement>("#a [data-voice-audio]");
    driven(audio);
    Object.defineProperty(audio, "duration", { value: 10, configurable: true });
    audio.dispatchEvent(new Event("loadedmetadata"));
    expect($<HTMLInputElement>("#a [data-voice-seek]").max).toBe("10");
    expect($("#a [data-voice-time]").textContent).toBe("0:00 / 0:10");
  });

  it("says when a note cannot be played, and retries it from the same button", async () => {
    const audio = $<HTMLAudioElement>("#a [data-voice-audio]");
    driven(audio);
    audio.dispatchEvent(new Event("error"));
    expect(state("a")).toBe("error");
    expect($("#a [data-voice-error]").textContent).toBe("Could not play.");
    expect($("#a [data-voice-toggle]").getAttribute("aria-label")).toBe("Retry");
    $<HTMLButtonElement>("#a [data-voice-toggle]").click();
    await flush();
    expect(audio.load).toHaveBeenCalledOnce();
    expect(audio.play).toHaveBeenCalledOnce();
    audio.dispatchEvent(new Event("playing"));
    expect($("#a [data-voice-error]").textContent).toBe("");
  });

  it("fails when the browser refuses to play, but not when a newer request replaced the play", async () => {
    driven($<HTMLAudioElement>("#a [data-voice-audio]"), "NotSupportedError");
    $<HTMLButtonElement>("#a [data-voice-toggle]").click();
    await flush();
    expect(state("a")).toBe("error");
    driven($<HTMLAudioElement>("#b [data-voice-audio]"), "AbortError");
    $<HTMLButtonElement>("#b [data-voice-toggle]").click();
    await flush();
    expect(state("b")).toBe("loading");
  });

  it("returns to the start when the note ends", () => {
    const audio = $<HTMLAudioElement>("#a [data-voice-audio]");
    const drive = driven(audio);
    drive.position = 11.8;
    audio.dispatchEvent(new Event("ended"));
    expect(audio.currentTime).toBe(0);
    expect(state("a")).toBe("idle");
  });

  it("stops binding when its page is left", () => {
    teardown();
    const audio = $<HTMLAudioElement>("#a [data-voice-audio]");
    driven(audio);
    $<HTMLButtonElement>("#a [data-voice-toggle]").click();
    expect(audio.play).not.toHaveBeenCalled();
    teardown = () => undefined;
  });
});
