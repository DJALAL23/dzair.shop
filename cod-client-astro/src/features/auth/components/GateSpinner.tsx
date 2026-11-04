const SIZES: Record<number, string> = {
  4: "h-4 w-4 border-2",
  7: "h-7 w-7 border-2",
};

export default function GateSpinner({ size = 7 }: { size?: number }) {
  return (
    <span
      role="status"
      className={`inline-block ${SIZES[size] ?? SIZES[7]} animate-spin rounded-full border-primary/30 border-t-primary`}
    />
  );
}
