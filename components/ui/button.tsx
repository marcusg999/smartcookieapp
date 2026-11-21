import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "cn";
import { Slot } from "radix-ui";

const buttonVariants = cva(
  "inline-flex shrink-0 cursor-pointer items-center justify-center gap-2 rounded-md text-[0.95rem] font-semibold whitespace-nowrap transition-[transform,box-shadow,background-color] duration-150 outline-none focus-visible:outline-3 focus-visible:outline-offset-3 focus-visible:outline-ink disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default:
          "border-2 border-ink bg-primary text-primary-foreground shadow-ink-sm hover:-translate-x-px hover:-translate-y-px hover:shadow-ink active:translate-x-0.5 active:translate-y-0.5 active:shadow-none",
        destructive:
          "border-2 border-ink bg-destructive text-white shadow-ink-sm hover:-translate-x-px hover:-translate-y-px hover:shadow-ink active:translate-x-0.5 active:translate-y-0.5 active:shadow-none",
        outline:
          "border-2 border-ink bg-card shadow-ink-sm hover:-translate-x-px hover:-translate-y-px hover:bg-accent hover:shadow-ink active:translate-x-0.5 active:translate-y-0.5 active:shadow-none",
        secondary:
          "border-2 border-ink bg-ink text-paper shadow-ink-sm hover:-translate-x-px hover:-translate-y-px hover:shadow-[4px_4px_0_0_var(--orange)] active:translate-x-0.5 active:translate-y-0.5 active:shadow-none",
        ghost: "hover:bg-ink/8",
        link: "text-ink underline decoration-orange decoration-[3px] underline-offset-4 hover:decoration-ink",
      },
      size: {
        default: "h-11 px-5 py-2 has-[>svg]:px-4",
        xs: "h-6 gap-1 rounded-md px-2 text-xs has-[>svg]:px-1.5 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-9 gap-1.5 rounded-md px-3 has-[>svg]:px-2.5",
        lg: "h-13 rounded-lg px-7 text-base has-[>svg]:px-5",
        icon: "size-9",
        "icon-xs": "size-6 rounded-md [&_svg:not([class*='size-'])]:size-3",
        "icon-sm": "size-8",
        "icon-lg": "size-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

function Button({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
  }) {
  const Comp = asChild ? Slot.Root : "button";

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}

export { Button, buttonVariants };
