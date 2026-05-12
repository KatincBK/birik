import { cn } from "../lib/cn";

/** Shimmer skeleton — index.css'teki .animate-shimmer keyframe'iyle çalışır.
 *  Spinner kullanmıyoruz (PLAN §6.1.H). */
export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "animate-shimmer rounded-md",
        className
      )}
      aria-hidden="true"
    />
  );
}
