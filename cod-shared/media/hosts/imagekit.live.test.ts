/**
 * The host contract against a real ImageKit account — the same suite the
 * fake passes. Runs only with IMAGEKIT_LIVE_PUBLIC_KEY and
 * IMAGEKIT_LIVE_PRIVATE_KEY in the environment (never in a file), in a
 * folder of its own that is deleted afterwards; the account check also needs
 * IMAGEKIT_LIVE_URL_ENDPOINT:
 *
 *   IMAGEKIT_LIVE_PUBLIC_KEY=… IMAGEKIT_LIVE_PRIVATE_KEY=… npx vitest run ../cod-shared/media/hosts/imagekit.live.test.ts
 *
 * An outage is played by answering 503 in place of the account; refused
 * credentials are real: the request goes to ImageKit with a wrong key.
 */
import { describe, expect, it } from "vitest";
import { checkImageKitAccount, imagekitHost } from "./imagekit";
import { followTicket } from "./testing/browser";
import { describeHostContract } from "./testing/host-contract";

const publicKey = process.env.IMAGEKIT_LIVE_PUBLIC_KEY;
const privateKey = process.env.IMAGEKIT_LIVE_PRIVATE_KEY;
const urlEndpoint = process.env.IMAGEKIT_LIVE_URL_ENDPOINT;
const live = Boolean(publicKey && privateKey);

const authorization = (key: string) => `Basic ${btoa(`${key}:`)}`;

(live ? describe : describe.skip)("on a live ImageKit account", () => {
  describeHostContract("ImageKit (live)", async () => {
    const folder = `/codflow-contract-${crypto.randomUUID()}`;
    let outages = 0;
    let refusals = 0;
    const send = async (request: Request): Promise<Response> => {
      if (outages > 0) {
        outages -= 1;
        return new Response(JSON.stringify({ message: "played outage" }), { status: 503 });
      }
      if (refusals > 0 && request.headers.has("authorization")) {
        refusals -= 1;
        const refused = new Request(request);
        refused.headers.set("authorization", authorization("private_not_this_account"));
        return fetch(refused);
      }
      return fetch(request);
    };
    const host = imagekitHost({ publicKey: publicKey!, privateKey: privateKey!, folder, fetch: send });
    return {
      host,
      browser: (ticket, file) => followTicket(ticket, file, fetch, host),
      failNext: (times) => (outages = times),
      refuseNext: () => (refusals = 1),
      dispose: async () => {
        await fetch("https://api.imagekit.io/v1/folder", {
          method: "DELETE",
          headers: { authorization: authorization(privateKey!), "content-type": "application/json" },
          body: JSON.stringify({ folderPath: folder }),
        });
      },
    };
  });
});

(live && urlEndpoint ? describe : describe.skip)("checking a live ImageKit account", () => {
  const account = () => ({ urlEndpoint: urlEndpoint!, publicKey: publicKey!, privateKey: privateKey! });

  it("passes the account's own values", async () => {
    expect(await checkImageKitAccount(account())).toEqual({ ok: true });
  }, 30_000);

  it("names a private key the account refuses", async () => {
    expect(await checkImageKitAccount({ ...account(), privateKey: "private_not_this_account" })).toEqual({ ok: false, problem: "private_key" });
  }, 30_000);

  it("names a public key the account refuses", async () => {
    expect(await checkImageKitAccount({ ...account(), publicKey: "public_not_this_account" })).toEqual({ ok: false, problem: "public_key" });
  }, 30_000);

  it("names a URL endpoint of another account", async () => {
    expect(await checkImageKitAccount({ ...account(), urlEndpoint: "https://ik.imagekit.io/not_this_account_wocart" })).toEqual({ ok: false, problem: "url_endpoint" });
  }, 30_000);
});
