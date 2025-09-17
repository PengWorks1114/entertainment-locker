export type ButtonVariant =
  | "primary"
  | "secondary"
  | "subtle"
  | "danger"
  | "outlineDanger";

export type ButtonSize = "sm" | "md" | "lg";

const buttonBase =
  "inline-flex items-center justify-center rounded-xl font-medium transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500 disabled:cursor-not-allowed disabled:opacity-60";

const sizeStyles: Record<ButtonSize, string> = {
  sm: "h-9 px-3 text-sm",
  md: "h-10 px-4 text-sm",
  lg: "h-12 px-6 text-base",
};

const variantStyles: Record<ButtonVariant, string> = {
  primary: "bg-gray-900 text-white shadow-sm hover:bg-black",
  secondary:
    "border border-gray-200 bg-white text-gray-700 shadow-sm hover:border-gray-300 hover:text-gray-900",
  subtle: "border border-transparent text-gray-600 hover:bg-gray-100 hover:text-gray-900",
  danger: "bg-red-600 text-white shadow-sm hover:bg-red-500",
  outlineDanger:
    "border border-red-200 bg-white text-red-600 hover:border-red-300 hover:bg-red-50",
};

export function buttonClass(
  options: { variant?: ButtonVariant; size?: ButtonSize } = {}
): string {
  const { variant = "secondary", size = "md" } = options;
  return `${buttonBase} ${sizeStyles[size]} ${variantStyles[variant]}`;
}

export const pillBadgeClass =
  "inline-flex items-center rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-700";
