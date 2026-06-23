import { format, parseISO, differenceInDays, isWithinInterval, startOfDay } from "date-fns";
import { ru } from "date-fns/locale";

export function formatDate(date: string | Date, formatStr: string = "d MMMM yyyy"): string {
  const dateObj = typeof date === "string" ? parseISO(date) : date;
  return format(dateObj, formatStr, { locale: ru });
}

export function formatDateShort(date: string | Date): string {
  return formatDate(date, "dd.MM.yyyy");
}

export function getTripDuration(startDate: string, endDate: string): number {
  return differenceInDays(parseISO(endDate), parseISO(startDate)) + 1;
}

export function formatDateRange(startDate: string, endDate: string): string {
  const start = parseISO(startDate);
  const end = parseISO(endDate);
  
  if (format(start, "yyyy-MM") === format(end, "yyyy-MM")) {
    return `${format(start, "d", { locale: ru })} - ${format(end, "d MMMM yyyy", { locale: ru })}`;
  }
  
  return `${format(start, "d MMMM", { locale: ru })} - ${format(end, "d MMMM yyyy", { locale: ru })}`;
}

export function isTripActive(startDate: string, endDate: string): boolean {
  const now = startOfDay(new Date());
  const start = startOfDay(parseISO(startDate));
  const end = startOfDay(parseISO(endDate));
  
  return isWithinInterval(now, { start, end });
}
