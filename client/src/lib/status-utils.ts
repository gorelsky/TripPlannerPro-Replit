import { TripStatus } from "@shared/schema";

export const statusLabels: Record<TripStatus, string> = {
  draft: "Черновик",
  pending: "Ожидает руководителя",
  manager_approved: "Ожидает (Директор)",
  director_approved: "Ожидает (ЗГД/Админ)",
  coordinator_review: "Проверка координатора",
  deputy_review: "Ожидает ЗГД",
  ceo_review: "Ожидает ГД",
  awaiting_ceo_signature: "В реестре на подпись ГД",
  planned: "Плановая (утверждена ГД)",
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
    coordinator_review: "bg-violet-600 text-white",
    deputy_review: "bg-indigo-600 text-white",
    ceo_review: "bg-sky-700 text-white",
    awaiting_ceo_signature: "bg-cyan-700 text-white",
    planned: "bg-emerald-600 text-white",
    approved: "bg-green-500 text-white",
    rejected: "bg-red-500 text-white",
    rescheduling: "bg-sky-500 text-white",
  };
  return colors[status];
}
