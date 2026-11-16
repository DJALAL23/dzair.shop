import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const fixture = (name: string) => new Uint8Array(readFileSync(resolve(__dirname, "../lib/review-media/__fixtures__", name)));

/** A real file of `__fixtures__` (a JPEG photo, WebP renderings, voice notes in each format). */
export const mediaFixture = fixture;

export interface FakeImages {
  binding: ImagesBinding;
  /** Every `transform` asked, in order. */
  calls: Array<{ width?: number; height?: number; fit?: string }>;
  /** The next outputs: "bad" fails as Images does on input it cannot read (9412), "transient" as an outage. */
  failures: Array<"bad" | "transient">;
}

/** The Images binding as review photos use it: a real WebP back, the thumbnail for an edge of 480 or less. */
export function fakeImages(): FakeImages {
  const calls: FakeImages["calls"] = [];
  const failures: FakeImages["failures"] = [];
  const binding = {
    input(stream: ReadableStream<Uint8Array>) {
      void stream.cancel();
      let edge = Infinity;
      const transformer = {
        transform(options: { width?: number; height?: number; fit?: string }) {
          edge = options.width ?? Infinity;
          calls.push(options);
          return transformer;
        },
        async output() {
          const failure = failures.shift();
          if (failure === "bad") throw Object.assign(new Error("not an image"), { code: 9412 });
          if (failure === "transient") throw new Error("image service unavailable");
          const body = fixture(edge <= 480 ? "photo-thumb.webp" : "photo-full.webp");
          return { response: () => new Response(body, { headers: { "Content-Type": "image/webp" } }) };
        },
      };
      return transformer;
    },
  } as unknown as ImagesBinding;
  return { binding, calls, failures };
}
