/**
 * The review voice player's behaviour.
 *
 * Pins the contract the shopper relies on: starting a note pauses the others,
 * the track and the time follow the position, a seek moves within the note,
 * and the note returns to its start when it ends. Bound by delegation, so a
 * card loaded later works without a second binding.
 */
/// <reference types="vitest/globals" />

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initVoicePlayers } from "../voice-player";

function player(id: string, durationMs: number): string {
  return `
    <div class="voice" data-voice id="${id}" data-duration-ms="${durationMs}" data-play-label="Play" data-pause-label="Pause">
      <audio data-voice-audio preload="none"></audio>
      <button type="button" data-voice-toggle aria-label="Play">▶</button>
      <input type="range" data-voice-seek min="0" max="1000" value="0" aria-label="Position" />
      <span data-voice-time>0:00 / 0:00</span>
    </div>`;
}

/** An audio element whose playback the test drives, since the test browser plays nothing. */
function driven(audio: HTMLAudioElement) {
  let paused = true;
  Object.defineProperty(audio, "paused", { get: () => paused, configurable: true });
  audio.play = vi.fn(async () => {
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
  it("plays a note on its toggle, and the toggle says it can pause", async () => {
    const audio = document.querySelector<HTMLAudioElement>("#a [data-voice-audio]")!;
    driven(audio);
    document.querySelector<HTMLButtonElement>("#a [data-voice-toggle]")!.click();
    await Promise.resolve();
    expect(audio.play).toHaveBeenCalledOnce();
    const root = document.getElementById("a")!;
    expect(root.classList.contains("is-playing")).toBe(true);
    expect(document.querySelector("#a [data-voice-toggle]")!.getAttribute("aria-label")).toBe("Pause");
  });

  it("starting one note pauses the note that was playing", async () => {
    const first = document.querySelector<HTMLAudioElement>("#a [data-voice-audio]")!;
    const second = document.querySelector<HTMLAudioElement>("#b [data-voice-audio]")!;
    driven(first);
    driven(second);
    document.querySelector<HTMLButtonElement>("#a [data-voice-toggle]")!.click();
    await Promise.resolve();
    document.querySelector<HTMLButtonElement>("#b [data-voice-toggle]")!.click();
    await Promise.resolve();
    expect(first.pause).toHaveBeenCalled();
    expect(document.getElementById("a")!.classList.contains("is-playing")).toBe(false);
    expect(document.getElementById("b")!.classList.contains("is-playing")).toBe(true);
  });

  it("follows the position on the track and in the time", () => {
    const audio = document.querySelector<HTMLAudioElement>("#b [data-voice-audio]")!;
    const drive = driven(audio);
    drive.position = 16.35;
    const seek = document.querySelector<HTMLInputElement>("#b [data-voice-seek]")!;
    const time = document.querySelector<HTMLElement>("#b [data-voice-time]")!;
    expect(time.textContent).toBe("0:16 / 1:05");
    expect(Number(seek.value)).toBeCloseTo(250, -1);
    expect(document.getElementById("b")!.style.getPropertyValue("--p")).toBe("25");
  });

  it("a seek moves within the note", () => {
    const audio = document.querySelector<HTMLAudioElement>("#a [data-voice-audio]")!;
    driven(audio);
    const seek = document.querySelector<HTMLInputElement>("#a [data-voice-seek]")!;
    seek.value = "500";
    seek.dispatchEvent(new Event("input", { bubbles: true }));
    expect(audio.currentTime).toBeCloseTo(6, 1);
  });

  it("seeks within the file's own length once it has loaded, not the length recorded for it", () => {
    const audio = document.querySelector<HTMLAudioElement>("#a [data-voice-audio]")!;
    driven(audio);
    Object.defineProperty(audio, "duration", { value: 10, configurable: true });
    const seek = document.querySelector<HTMLInputElement>("#a [data-voice-seek]")!;
    seek.value = "500";
    seek.dispatchEvent(new Event("input", { bubbles: true }));
    expect(audio.currentTime).toBeCloseTo(5, 1);
  });

  it("returns to the start when the note ends", () => {
    const audio = document.querySelector<HTMLAudioElement>("#a [data-voice-audio]")!;
    const drive = driven(audio);
    drive.position = 11.8;
    audio.dispatchEvent(new Event("ended"));
    expect(audio.currentTime).toBe(0);
    expect(document.getElementById("a")!.classList.contains("is-playing")).toBe(false);
  });

  it("stops binding when its page is left", () => {
    teardown();
    const audio = document.querySelector<HTMLAudioElement>("#a [data-voice-audio]")!;
    driven(audio);
    document.querySelector<HTMLButtonElement>("#a [data-voice-toggle]")!.click();
    expect(audio.play).not.toHaveBeenCalled();
    teardown = () => undefined;
  });
});
