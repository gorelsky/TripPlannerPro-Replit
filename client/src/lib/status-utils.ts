import { TripStatus } from "@shared/schema";

export const statusLabels: Record<TripStatus, string> = {
  draft: "Черновик",
  pending: "Ожидает руководителя",
  manager_approved: "Ожидает (Директор)",
  director_approved: "Ожидает (ЗГД/Админ)",
  approved: "Согласовано",
  rejected: "Отклонено",
  rescheduling: "На переносе",
};

export function getStatusColor(status: TripStatus): string {
  const colors: Record<TripStatus, string> = {
    draft: "bg-muted text-muted-foreground",
    pending: "bg-amber-500 text-white",
    manager_approved: "bg-blue-400 text-white",
    director_approved: "bg-blue-600 text-white",
    approved: "bg-green-500 text-white",
    rejected: "bg-red-500 text-white",
    rescheduling: "bg-sky-500 text-white",
  };
  return colors[status];
}
