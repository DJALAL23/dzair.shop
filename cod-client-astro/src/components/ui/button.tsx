import { forwardRef, type ButtonHTMLAttributes } from "react";

export type ButtonVariant =
  | "primary"
  | "secondary"
  | "ghost"
  | "danger"
  | "dangerOutline"
  | "outline"
  | "brand";
export type ButtonSize = "default" | "sm" | "lg" | "icon";

const base =
  "inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-lg font-semibold transition-[background-color,box-shadow,color,transform] duration-150 ease-out select-none outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background active:translate-y-px disabled:pointer-events-none disabled:opacity-45 [&_svg]:shrink-0";

const variants: Record<ButtonVariant, string> = {
  primary:
    "bg-primary text-primary-foreground shadow-button-primary hover:bg-primary/88 active:shadow-none",
  secondary:
    "bg-card text-card-foreground shadow-button hover:bg-subtle active:bg-muted active:shadow-xs",
  ghost:
    "text-foreground/80 hover:bg-foreground/[0.06] hover:text-foreground active:bg-foreground/[0.09]",
  danger:
    "bg-destructive text-destructive-foreground shadow-[inset_0_1px_0_rgb(255_255_255/0.18),inset_0_-1px_0_rgb(0_0_0/0.35),0_0_0_1px_var(--destructive)] hover:bg-destructive/90 active:shadow-none",
  dangerOutline:
    "bg-card text-destructive shadow-button hover:bg-[var(--tone-critical-bg)] active:shadow-xs",
  outline:
    "bg-transparent text-foreground shadow-[0_0_0_1px_var(--input)] hover:bg-foreground/[0.04] active:bg-foreground/[0.07]",
  brand:
    "bg-brand text-brand-foreground shadow-[inset_0_1px_0_rgb(255_255_255/0.2),inset_0_-1px_0_rgb(0_0_0/0.3),0_0_0_1px_var(--brand)] hover:bg-brand/90 active:shadow-none",
};

const sizes: Record<ButtonSize, string> = {
  default: "h-8 px-3 text-sm pointer-coarse:h-10 pointer-coarse:px-4",
  sm: "h-7 px-2.5 text-xs pointer-coarse:h-9",
  lg: "h-10 px-4 text-sm",
  icon: "size-8 p-0 pointer-coarse:size-10",
};

export function buttonVariants(
  options: {
    variant?: ButtonVariant;
    size?: ButtonSize;
    className?: string;
  } = {},
) {
  const { variant = "primary", size = "default", className = "" } = options;
  return `${base} ${variants[variant]} ${sizes[size]} ${className}`;
}

export const Button = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> & {
    variant?: ButtonVariant;
    size?: ButtonSize;
  }
>(function Button(
  { variant = "primary", size = "default", className = "", ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      {...props}
      className={buttonVariants({ variant, size, className })}
    />
  );
});
