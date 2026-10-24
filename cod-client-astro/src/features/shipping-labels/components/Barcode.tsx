import { barcodeGeometry } from "@/features/shipping-labels/model";

/** A Code 128 barcode at its physical size: crisp edges, black on white, quiet zones included. */
export function Barcode({ text, maxWidthMm, heightMm }: { text: string; maxWidthMm: number; heightMm: number }) {
  const { bars, modules, widthMm } = barcodeGeometry(text, maxWidthMm);
  return (
    <svg
      role="img"
      aria-label={text}
      viewBox={`0 0 ${modules} 1`}
      preserveAspectRatio="none"
      shapeRendering="crispEdges"
      style={{ width: `${widthMm}mm`, height: `${heightMm}mm`, display: "block", background: "#fff" }}
    >
      {bars.map((bar) => (
        <rect key={bar.x} x={bar.x} y={0} width={bar.width} height={1} fill="#000" />
      ))}
    </svg>
  );
}
