"use client";

type FavoriteToggleButtonProps = {
  isFavorite: boolean;
  onToggle: () => void;
  disabled?: boolean;
  size?: "sm" | "md";
  className?: string;
  ariaLabel?: string;
};

export default function FavoriteToggleButton({
  isFavorite,
  onToggle,
  disabled = false,
  size = "md",
  className,
  ariaLabel,
}: FavoriteToggleButtonProps) {
  const buttonSizeClass = size === "sm" ? "h-9 w-9" : "h-10 w-10";
  const iconSizeClass = size === "sm" ? "h-4 w-4" : "h-5 w-5";
  const stateClass = isFavorite
    ? "border-red-200 bg-red-50 text-red-600 hover:bg-red-100"
    : "border-red-200 bg-white text-red-400 hover:bg-red-50 hover:text-red-500";
  const composedClassName = [
    "inline-flex items-center justify-center rounded-full border transition",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-200",
    "disabled:cursor-not-allowed disabled:opacity-60",
    buttonSizeClass,
    stateClass,
    className,
  ]
    .filter(Boolean)
    .join(" ");
  const label = ariaLabel ?? (isFavorite ? "取消最愛" : "加入最愛");

  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={disabled}
      aria-pressed={isFavorite}
      aria-label={label}
      title={label}
      className={composedClassName}
    >
      <svg
        viewBox="0 0 24 24"
        aria-hidden="true"
        className={iconSizeClass}
        fill={isFavorite ? "currentColor" : "none"}
        stroke="currentColor"
        strokeWidth={1.8}
      >
        <path
          d="M12 20s-6.333-4.493-8.485-6.646C1.343 11.182 1.343 7.818 3.515 5.646 5.686 3.475 9.05 3.475 11.222 5.646L12 6.424l.778-.778c2.172-2.171 5.536-2.171 7.707 0 2.172 2.172 2.172 5.536 0 7.708C18.333 15.507 12 20 12 20z"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </button>
  );
}

