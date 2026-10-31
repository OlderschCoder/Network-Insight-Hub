import { cn } from "@/lib/utils";
import scccLogo from "@/assets/brand/sccc-logo.png";
import scccLogoWhite from "@/assets/brand/sccc-logo-white.png";

export function Logo({
  variant = "color",
  className,
}: {
  variant?: "color" | "white";
  className?: string;
}) {
  return (
    <img
      src={variant === "white" ? scccLogoWhite : scccLogo}
      alt="Seward County Community College"
      className={cn("h-9 w-auto select-none", className)}
      draggable={false}
    />
  );
}
