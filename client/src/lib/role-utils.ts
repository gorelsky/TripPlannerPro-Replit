import type { UserRole } from "@shared/schema";

export const roleLabels: Record<UserRole, string> = {
  admin: "Администратор",
  territorial_manager: "Территориальный менеджер",
  commercial_manager: "Менеджер коммерческого отдела",
  marketing_director: "Директор маркетинга",
  sales_director: "Директор продаж",
  commerce_director: "Директор коммерции",
  product_manager: "Продакт-менеджер",
  kam: "КАМ",
  ceo: "Генеральный директор",
  deputy_ceo: "Заместитель генерального директора",
};

export const roleShortLabels: Record<UserRole, string> = {
  admin: "Admin",
  territorial_manager: "ТМ",
  commercial_manager: "МК",
  marketing_director: "ДМ",
  sales_director: "ДП",
  commerce_director: "ДК",
  product_manager: "ПМ",
  kam: "КАМ",
  ceo: "ГД",
  deputy_ceo: "ЗГД",
};

export function isAdmin(role: UserRole | null | undefined): boolean {
  return role === "admin";
}

export function getRoleColor(role: UserRole | null | undefined): string {
  if (!role) return "secondary";
  const colorMap: Record<UserRole, string> = {
    admin: "destructive",
    territorial_manager: "default",
    commercial_manager: "default",
    marketing_director: "default",
    sales_director: "default",
    commerce_director: "default",
    product_manager: "default",
    kam: "default",
    ceo: "default",
    deputy_ceo: "default",
  };
  return colorMap[role] || "secondary";
}

export function getRoleLabel(role: UserRole | null | undefined): string {
  if (!role) return "Сотрудник";
  return roleLabels[role] || "Сотрудник";
}

export function determineRoleFromJobTitle(jobTitle: string | undefined): UserRole | null {
  if (!jobTitle) return null;
  
  const jobLower = jobTitle.trim().toLowerCase();
  
  if (jobLower.includes("генеральный директор") || 
      jobLower.includes("главный директор") ||
      jobLower.includes("гд")) {
    return "ceo";
  }
  
  if (jobLower.includes("заместитель генерального директора") || 
      jobLower.includes("заместитель гена") ||
      jobLower.includes("ззгд")) {
    return "deputy_ceo";
  }
  
  if (jobLower.includes("директор маркетинга") || jobLower.includes("директор по маркетингу")) {
    return "marketing_director";
  }
  if (jobLower.includes("директор продаж") || jobLower.includes("директор по продажам")) {
    return "sales_director";
  }
  if (jobLower.includes("директор коммер") || jobLower.includes("директор по коммер")) {
    return "commerce_director";
  }
  
  if (
    jobLower.includes("территориальный менеджер") ||
    (jobLower.includes("тер") && jobLower.includes("менеджер") && !jobLower.includes("медицинский"))
  ) {
    return "territorial_manager";
  }
  if (jobLower.includes("коммерческий менеджер") || jobLower.includes("менеджер коммер")) {
    return "commercial_manager";
  }
  
  if (jobLower.includes("продакт") || jobLower.includes("product manager")) {
    return "product_manager";
  }
  
  if (jobLower.includes("км") || jobLower.includes("ключевой")) {
    return "kam";
  }
  
  return null;
}
