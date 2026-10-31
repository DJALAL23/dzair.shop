// @vitest-environment node
// Node environment: the Astro container renders the real component (see
// ProductDescription.render.test.ts for why).
/**
 * The voice note's player, as the storefront renders it: the theme's own
 * controls, the note not fetched until played, and every label it reads from
 * the content pack.
 */
/// <reference types="vitest/globals" />

import { experimental_AstroContainer as AstroContainer } from "astro/container";
import { describe, expect, it } from "vitest";
import VoicePlayer from "../VoicePlayer.astro";
import { en } from "@/theme/content/en";
import { fr } from "@/theme/content/fr";
import { testLocals } from "@/theme/__tests__/support/locals";

const copy = (pack: typeof en) => ({
  label: pack.reviewsVoiceNote,
  play: pack.reviewsPlayVoice,
  pause: pack.reviewsPauseVoice,
  seek: pack.reviewsSeekVoice,
  retry: pack.reviewsVoiceRetry,
  error: pack.reviewsVoiceError,
  position: pack.reviewsVoicePosition,
});

async function render(props: { src: string; durationMs: number | null }, pack = en) {
  const container = await AstroContainer.create();
  return container.renderToString(VoicePlayer, { props: { ...props, copy: copy(pack) }, locals: testLocals() });
}

describe("the voice note player", () => {
  it("draws its own controls: no native audio controls, and the note is not fetched until played", async () => {
    const html = await render({ src: "https://media.example/voice.webm", durationMs: 12_400 });
    expect(html).toContain("<audio");
    expect(html).not.toMatch(/<audio[^>]*\scontrols/);
    expect(html).toContain('preload="none"');
    expect(html).toContain('src="https://media.example/voice.webm"');
  });

  it("reads its labels from the pack, in the shopper's language", async () => {
    const english = await render({ src: "/a.webm", durationMs: 1_000 });
    expect(english).toContain(`aria-label="${en.reviewsPlayVoice}"`);
    expect(english).toContain(`aria-label="${en.reviewsSeekVoice}"`);
    expect(english).toContain(`aria-label="${en.reviewsVoiceNote}"`);
    const french = await render({ src: "/a.webm", durationMs: 1_000 }, fr);
    expect(french).toContain(`aria-label="${fr.reviewsPlayVoice}"`);
  });

  it("shows the length, and carries it for the script that tracks the position", async () => {
    const html = await render({ src: "/a.webm", durationMs: 65_400 });
    expect(html).toContain("0:00 / 1:05");
    expect(html).toContain('data-duration-ms="65400"');
  });

  it("is a group a screen reader can follow: a one-second track that never mirrors, its position in words, a place for its error", async () => {
    const html = await render({ src: "/a.webm", durationMs: 65_400 });
    expect(html).toMatch(/role="group"[^>]*aria-label="Voice review"/);
    expect(html).toMatch(/<input type="range" dir="ltr"[^>]*max="65" step="1"/);
    expect(html).toContain('aria-valuetext="0:00 of 1:05"');
    expect(html).toMatch(/data-voice-error role="status" aria-live="polite"/);
    expect(html).toContain(`data-retry-label="${en.reviewsVoiceRetry}"`);
  });

  it("starts from an empty source for a card a script fills in later, its track waiting for a length", async () => {
    const html = await render({ src: "", durationMs: null });
    expect(html).toContain("0:00 / 0:00");
    expect(html).not.toMatch(/<audio[^>]*\ssrc=/);
    expect(html).toMatch(/<input type="range"[^>]*disabled/);
  });
});
