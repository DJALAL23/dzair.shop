/**
 * Waits until the page prints as it looks — its fonts loaded and every image
 * decoded (an Arabic name in a fallback font, or a logo still loading, would
 * print wrong) — then runs `print`. An image that fails to load is printed
 * without, never waited on for ever.
 */
export async function whenPrintable(print: () => void): Promise<void> {
  await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
  await document.fonts?.ready;
  await Promise.all(
    Array.from(document.images).map((image) =>
      image.complete ? Promise.resolve() : image.decode().catch(() => undefined),
    ),
  );
  print();
}
