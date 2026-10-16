import type { AnchorHTMLAttributes, ButtonHTMLAttributes } from "react";
import { buttonVariants, type ButtonSize, type ButtonVariant } from "./button";

export function LinkButton({
  variant = "primary",
  size = "default",
  className = "",
  ...props
}: AnchorHTMLAttributes<HTMLAnchorElement> & {
  href: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
}) {
  return (
    <a {...props} className={buttonVariants({ variant, size, className })} />
  );
}

export function IconButton({
  variant = "ghost",
  size = "default",
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "ghost" | "solid" | "secondary" | "danger";
  size?: "default" | "sm";
}) {
  const variants = {
    ghost: "text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground active:bg-foreground/[0.09]",
    solid: "bg-primary text-primary-foreground shadow-button-primary hover:bg-primary/88",
    secondary: "bg-card text-foreground shadow-button hover:bg-subtle active:bg-muted",
    danger: "text-muted-foreground hover:bg-[var(--tone-critical-bg)] hover:text-destructive active:bg-[var(--tone-critical-bg)]",
  };
  const sizeClasses = {
    default: "size-8 rounded-lg pointer-coarse:size-10",
    sm: "size-7 rounded-md pointer-coarse:size-9",
  };
  return (
    <button
      {...props}
      className={`grid shrink-0 place-items-center transition-[background-color,color,transform] duration-150 active:translate-y-px disabled:pointer-events-none disabled:opacity-45 select-none outline-none focus-visible:ring-2 focus-visible:ring-ring ${sizeClasses[size]} ${variants[variant]} ${className}`}
    />
  );
}
