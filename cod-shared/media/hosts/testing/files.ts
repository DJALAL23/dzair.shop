/** Files whose first bytes say what they are, padded to `size` bytes. */

const pad = (head: number[], size: number) => {
  const bytes = new Uint8Array(Math.max(size, head.length));
  bytes.set(head);
  return bytes;
};
const ascii = (text: string) => Array.from(text, (c) => c.charCodeAt(0));

export const png = (size = 256) => pad([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], size);
export const jpeg = (size = 256) => pad([0xff, 0xd8, 0xff, 0xe0], size);
export const webp = (size = 256) => pad([...ascii("RIFF"), 0, 0, 0, 0, ...ascii("WEBPVP8 ")], size);
export const webm = (size = 256) => pad([0x1a, 0x45, 0xdf, 0xa3, 0x9f], size);
export const pdf = (size = 256) => pad(ascii("%PDF-1.7"), size);

export const stream = (bytes: Uint8Array) =>
  new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
