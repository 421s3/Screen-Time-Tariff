import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"
import { Slot } from "radix-ui"

const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 rounded-lg text-sm font-semibold whitespace-nowrap transition-[transform,background-color,border-color,color] duration-150 outline-none hover:-translate-y-px active:translate-y-px focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-[#6340ea]",
        cta: "bg-gradient-to-r from-[#6a47f0] to-[#6f3fe0] text-white shadow-[0_6px_16px_-8px_rgba(106,71,240,0.7)] hover:from-[#5e3be6] hover:to-[#6334d4]",
        dark: "bg-ink text-white hover:bg-[#2b2847]",
        brand: "bg-brand text-white hover:bg-[#4b3ac4]",
        success: "bg-good text-white hover:bg-[#12603f]",
        destructive: "bg-destructive text-white hover:bg-destructive/90 focus-visible:ring-destructive/20",
        outline: "border border-input bg-card text-foreground hover:border-purple hover:text-brand",
        secondary: "bg-secondary text-secondary-foreground hover:bg-[#e8e5dc]",
        ghost: "hover:bg-accent hover:text-accent-foreground hover:translate-y-0 active:translate-y-0",
        link: "text-brand underline-offset-4 hover:underline hover:translate-y-0 active:translate-y-0",
      },
      size: {
        default: "h-10 px-4 has-[>svg]:px-3.5",
        xs: "h-7 gap-1 rounded-md px-2 text-xs has-[>svg]:px-1.5 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-9 gap-1.5 rounded-md px-3 has-[>svg]:px-2.5",
        lg: "h-11 px-5 text-[15px] has-[>svg]:px-4",
        icon: "size-10",
        "icon-xs": "size-7 rounded-md [&_svg:not([class*='size-'])]:size-3",
        "icon-sm": "size-9",
        "icon-lg": "size-11",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot.Root : "button"

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
