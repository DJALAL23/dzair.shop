/**
 * `/media/{key}` as documentation only: the route takes Hono's regex param
 * (`:key{.+}`) so keys holding slashes match, which a @hono/zod-openapi
 * createRoute path cannot express. src/openapi/serve.ts merges it into the
 * generated document.
 */

const json = (schema: object) => ({ "application/json": { schema } });

export const mediaPaths = {
  "/media/{key}": {
    get: {
      tags: ["Media"],
      summary: "Serve a media file",
      description:
        "A file of the store's media, for a store whose server serves its media itself (`direct` delivery — local development). Public, cached as immutable. On a store whose host delivers its own files, every key answers 404: use the URL the API gives.",
      operationId: "serveMedia",
      security: [],
      parameters: [{ name: "key", in: "path", required: true, schema: { type: "string" }, description: "A Media Key, e.g. `products/3f2a9c0b1d2e4f5061728394a5b6c7d8.webp`" }],
      responses: {
        "200": { description: "The file, with its Content-Type" },
        "404": {
          description: "Not a key this server serves",
          content: json({ type: "object", properties: { error: { type: "string" }, code: { type: "string", example: "MEDIA_NOT_FOUND" } } }),
        },
      },
    },
  },
};
