import { type UpdateFrequency } from "./types";

export function calculateNextUpdateDate(
  frequency: UpdateFrequency | null,
  fromDate: Date = new Date()
): Date | null {
  if (!frequency || frequency === "irregular") {
    return null;
  }
  const base = new Date(fromDate.getTime());
  switch (frequency) {
    case "weekly": {
      base.setDate(base.getDate() + 7);
      break;
    }
    case "biweekly": {
      base.setDate(base.getDate() + 14);
      break;
    }
    case "monthly": {
      const day = base.getDate();
      base.setMonth(base.getMonth() + 1);
      // 避免月底導致跨月錯誤，若日期被自動調整則回退至月底
      if (base.getDate() < day) {
        base.setDate(0);
      }
      break;
    }
    default:
      return null;
  }
  return base;
}
