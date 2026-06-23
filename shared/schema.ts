import { sql } from "drizzle-orm";
import { pgTable, text, varchar, timestamp, date } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// Роли пользователей
export type UserRole = 
  | "admin" // Администратор системы
  | "territorial_manager" // Территориальный менеджер (ТМ) -> Директор продаж
  | "commercial_manager" // Менеджер коммерческого отдела -> Директор коммерции
  | "marketing_director" // Директор отдела маркетинга -> ЗГД
  | "sales_director" // Директор отдела продаж -> ЗГД
  | "commerce_director" // Директор отдела коммерции -> ЗГД
  | "product_manager" // Продакт-менеджер -> Директор маркетинга
  | "kam" // КАМ -> Директор коммерции
  | "ceo" // Генеральный директор
  | "deputy_ceo"; // Заместитель генерального директора

// Статусы командировки
export type TripStatus = "draft" | "pending" | "manager_approved" | "director_approved" | "approved" | "rejected";

// Пользователи/Сотрудники
export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  fullName: text("full_name").notNull(),
  email: text("email").notNull().unique(),
  password: text("password").notNull(), // Хешированный пароль
  role: text("role").$type<UserRole>(), // Роль может быть null для обычных сотрудников
  jobTitle: text("job_title"), // Должность из Excel (как есть, без изменений)
  userType: text("user_type").notNull().default("employee").$type<"employee" | "manager">(), // Признак: сотрудник или руководитель
  managerId: varchar("manager_id"), // ID руководителя отдела
  managerName: text("manager_name"), // ФИО руководителя из Excel (как есть, без изменений)
  department: text("department"), // Отдел - КЛЮЧЕВОЙ ФИЛЬТР для видимости коллег
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Города
export const cities = pgTable("cities", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull().unique(),
  region: text("region"), // Регион
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Виды транспорта
export type TransportType = "plane" | "train" | "car";

// Командировки
export const trips = pgTable("trips", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  employeeId: varchar("employee_id").notNull(),
  cityId: varchar("city_id"), // Опционально
  startDate: date("start_date").notNull(),
  endDate: date("end_date").notNull(),
  purpose: text("purpose").notNull(), // Цель командировки
  routeId: varchar("route_id").notNull(), // Теперь обязательный
  transportType: text("transport_type").$type<TransportType>().notNull().default("car"), // Вид транспорта
  status: text("status").notNull().$type<TripStatus>().default("draft"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Согласования
export const approvals = pgTable("approvals", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tripId: varchar("trip_id").notNull(),
  approverId: varchar("approver_id").notNull(),
  status: text("status").notNull().$type<TripStatus>(),
  comment: text("comment"), // Комментарий при согласовании/отклонении
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Маршруты (расстояния между городами)
export const routes = pgTable("routes", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  path: text("path").notNull(), // "Москва-Владимир-Гусь Хрустальный" 
  distance: text("distance").notNull(), // "346 км"
  cities: text("cities").array().notNull(), // ["Москва", "Владимир", "Гусь Хрустальный"]
  kilometers: text("kilometers").notNull(), // "346"
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Справочник суточных (daily allowance)
export const dailyAllowance = pgTable("daily_allowance", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  amountPerNight: text("amount_per_night").notNull(), // Сумма за одну ночь (1700)
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Справочник праздников
export const holidays = pgTable("holidays", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  date: text("date").notNull().unique(), // Формат "YYYY-MM-DD"
  description: text("description"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertHolidaySchema = createInsertSchema(holidays).omit({
  id: true,
  createdAt: true,
});

export const contactMessages = pgTable("contact_messages", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  fromUserId: varchar("from_user_id").notNull(),
  fromUserName: varchar("from_user_name").notNull(),
  fromUserEmail: varchar("from_user_email").notNull(),
  subject: varchar("subject").notNull(),
  message: text("message").notNull(),
  attachmentUrl: text("attachment_url"),
  attachmentName: text("attachment_name"),
  attachmentContentType: text("attachment_content_type"),
  isRead: text("is_read").notNull().default("false"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertContactMessageSchema = createInsertSchema(contactMessages).omit({
  id: true,
  createdAt: true,
});

export type ContactMessage = typeof contactMessages.$inferSelect;
export type InsertContactMessage = z.infer<typeof insertContactMessageSchema>;

export type Holiday = typeof holidays.$inferSelect;
export type InsertHoliday = z.infer<typeof insertHolidaySchema>;

// Insert Schemas
export const insertUserSchema = createInsertSchema(users).omit({
  id: true,
  createdAt: true,
  password: true, // Пароль генерируется на сервере
}).extend({
  userType: z.enum(["employee", "manager"]).optional().default("employee"),
});

export const insertCitySchema = createInsertSchema(cities).omit({
  id: true,
  createdAt: true,
});

export const insertTripSchema = createInsertSchema(trips).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
}).extend({
  startDate: z.string(),
  endDate: z.string(),
});

export const insertApprovalSchema = createInsertSchema(approvals).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertRouteSchema = createInsertSchema(routes).omit({
  id: true,
  createdAt: true,
});

export const insertDailyAllowanceSchema = createInsertSchema(dailyAllowance).omit({
  id: true,
  updatedAt: true,
});

// Types
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;

export type InsertCity = z.infer<typeof insertCitySchema>;
export type City = typeof cities.$inferSelect;

export type InsertTrip = z.infer<typeof insertTripSchema>;
export type Trip = typeof trips.$inferSelect;

export type InsertApproval = z.infer<typeof insertApprovalSchema>;
export type Approval = typeof approvals.$inferSelect;

export type InsertRoute = z.infer<typeof insertRouteSchema>;
export type Route = typeof routes.$inferSelect;

export type InsertDailyAllowance = z.infer<typeof insertDailyAllowanceSchema>;
export type DailyAllowance = typeof dailyAllowance.$inferSelect;

// Extended types для отображения
export type ApprovalWithApprover = Approval & {
  approver?: Pick<User, "id" | "fullName" | "jobTitle">;
};

export type TripWithDetails = Trip & {
  employee: User;
  city?: City;
  route: Route;
  approvals?: ApprovalWithApprover[];
};

export type UserWithManager = User & {
  manager?: User;
};
