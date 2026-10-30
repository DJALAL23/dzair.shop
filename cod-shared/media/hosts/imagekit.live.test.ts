/**
 * The host contract against a real ImageKit account — the same suite the
 * fake passes. Runs only with IMAGEKIT_LIVE_PUBLIC_KEY and
 * IMAGEKIT_LIVE_PRIVATE_KEY in the environment (never in a file), in a
 * folder of its own that is deleted afterwards:
 *
 *   IMAGEKIT_LIVE_PUBLIC_KEY=… IMAGEKIT_LIVE_PRIVATE_KEY=… npx vitest run ../cod-shared/media/hosts/imagekit.live.test.ts
 *
 * An outage is played by answering 503 in place of the account; refused
 * credentials are real: the request goes to ImageKit with a wrong key.
 */
import { describe } from "vitest";
import { imagekitHost } from "./imagekit";
import { followTicket } from "./testing/browser";
import { describeHostContract } from "./testing/host-contract";

const publicKey = process.env.IMAGEKIT_LIVE_PUBLIC_KEY;
const privateKey = process.env.IMAGEKIT_LIVE_PRIVATE_KEY;
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
