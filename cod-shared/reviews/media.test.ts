import { describe, expect, it } from "vitest";
import { isMediaKey } from "../media/keys";
import { isThumbKey, mediaIdOf, photoKeys, staffFolder, uploadKeys, voiceKey } from "./media";

const grant = "a".repeat(32);
const id = "b".repeat(32);

describe("where review media lives", () => {
  it("keeps a file under the folder of whoever sent it, as a Media Key", () => {
    expect(photoKeys(grant, id)).toEqual({ key: `reviews/${grant}/${id}.webp`, thumbKey: `reviews/${grant}/${id}-t.webp` });
    expect(voiceKey(grant, id, "audio/mp4")).toBe(`reviews/${grant}/${id}.m4a`);
    expect(voiceKey(grant, id, "audio/webm")).toBe(`reviews/${grant}/${id}.webm`);
    for (const key of uploadKeys(grant, id)) expect(isMediaKey(key), key).toBe(true);
  });

  it("gives each staff member a folder no grant can name, whatever their id holds", () => {
    expect(staffFolder("u-1")).toBe("staff-u-1");
    expect(staffFolder("a/../b c")).toBe("staff-a____b_c");
    expect(isMediaKey(photoKeys(staffFolder("a/../b c"), id).key)).toBe(true);
    expect(staffFolder("x".repeat(100))).toHaveLength(6 + 64);
  });

  it("names every key an upload can have kept, and reads the upload back from each", () => {
    const keys = uploadKeys(grant, id);
    expect(keys).toEqual([
      `reviews/${grant}/${id}.webp`,
      `reviews/${grant}/${id}-t.webp`,
      `reviews/${grant}/${id}.webm`,
      `reviews/${grant}/${id}.ogg`,
      `reviews/${grant}/${id}.m4a`,
      `reviews/${grant}/${id}.mp3`,
    ]);
    for (const key of keys) expect(mediaIdOf(key)).toBe(id);
    expect(keys.filter(isThumbKey)).toEqual([`reviews/${grant}/${id}-t.webp`]);
  });
});
