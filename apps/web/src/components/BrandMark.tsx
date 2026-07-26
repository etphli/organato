import type { ComponentPropsWithoutRef } from "react";
import "./BrandMark.css";

type BrandMarkVariant = "accent" | "monochrome";

interface BrandMarkProps extends Omit<
  ComponentPropsWithoutRef<"svg">,
  "children" | "title"
> {
  size?: number | string;
  title?: string;
  variant?: BrandMarkVariant;
}

export function BrandMark({
  className,
  size = 20,
  title,
  variant = "accent",
  ...props
}: BrandMarkProps) {
  const classes = ["brand-mark", `brand-mark--${variant}`, className]
    .filter(Boolean)
    .join(" ");

  return (
    <svg
      {...props}
      aria-hidden={title ? undefined : true}
      aria-label={title}
      className={classes}
      focusable="false"
      height={size}
      role={title ? "img" : undefined}
      viewBox="0 0 32 32"
      width={size}
      xmlns="http://www.w3.org/2000/svg"
    >
      {title ? <title>{title}</title> : null}
      <path
        className="brand-mark__orbit"
        d="M26.4 14.54A10.5 10.5 0 1 1 20.93 6.73"
      />
      <circle className="brand-mark__point" cx="24.6" cy="9.98" r="1.35" />
    </svg>
  );
}
