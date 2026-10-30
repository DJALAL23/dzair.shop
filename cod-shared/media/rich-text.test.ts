import { describe, expect, it } from "vitest";
import { mediaDelivery } from "./delivery";
import { mediaKeysIn, toServedHtml, toStoredHtml } from "./rich-text";

const delivery = mediaDelivery("imagekit", "https://ik.imagekit.io/wocart/stores/maysa");
const URL_A = "https://ik.imagekit.io/wocart/stores/maysa/products/a.webp";

describe("rich text", () => {
  it("stores the store's image URLs as keys, and leaves every other URL alone", () => {
    const html = `<p>Robe</p><img src="${URL_A}" alt="a"><img src='${URL_A}?tr=w-400'><img src="https://cdn.example.com/x.jpg"><a href="https://boutique.dz/products/robe">robe</a>`;
    expect(toStoredHtml(html, delivery)).toBe(
      `<p>Robe</p><img src="media:products/a.webp" alt="a"><img src='media:products/a.webp'><img src="https://cdn.example.com/x.jpg"><a href="https://boutique.dz/products/robe">robe</a>`,
    );
  });

  it("serves stored keys as the delivery's URLs, and leaves what is not a key alone", () => {
    const stored = `<img src="media:products/a.webp"><img srcset="media:products/a.webp 1x, media:landing/b.webp 2x"><p>media:not a key</p><img src="media:../x">`;
    expect(toServedHtml(stored, delivery)).toBe(
      `<img src="${URL_A}"><img srcset="${URL_A} 1x, https://ik.imagekit.io/wocart/stores/maysa/landing/b.webp 2x"><p>media:not a key</p><img src="media:../x">`,
    );
  });

  it("round-trips: what is stored is served, and what is served is stored back the same", () => {
    const stored = `<p><img src="media:products/a.webp"> and <img src="https://cdn.example.com/x.jpg"></p>`;
    expect(toStoredHtml(toServedHtml(stored, delivery), delivery)).toBe(stored);
  });
});

describe("the keys rich text shows", () => {
  it("are its media: keys, once each", () => {
    expect(mediaKeysIn(`<img src="media:products/a.webp"><img src="media:products/a.webp"><img src="media:../x"><img src="${URL_A}">`)).toEqual(["products/a.webp"]);
    expect(mediaKeysIn(null)).toEqual([]);
  });
});
