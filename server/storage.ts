import { 
  type User, 
  type InsertUser,
  type UserRole,
  type City,
  type InsertCity,
  type Trip,
  type InsertTrip,
  type Approval,
  type InsertApproval,
  type Route,
  type InsertRoute,
  type DailyAllowance,
  type InsertDailyAllowance,
  type TripWithDetails,
  type UserWithManager,
  type TripStatus,
  type Holiday,
  type InsertHoliday,
  type ContactMessage,
  type InsertContactMessage,
  type ChatMessage,
  type InsertChatMessage,
  users,
  cities,
  trips,
  approvals,
  routes,
  dailyAllowance,
  holidays,
  contactMessages,
  chatMessages,
} from "@shared/schema";
import { randomUUID, createHash, randomBytes, scryptSync, timingSafeEqual } from "crypto";
import { db } from "./db";
import { eq, ne, sql } from "drizzle-orm";

export interface IStorage {
  // Users
  getUser(id: string): Promise<User | undefined>;
  getUserByEmail(email: string): Promise<User | undefined>;
  getAllUsers(): Promise<User[]>;
  getUsersByRole(role: string): Promise<User[]>;
  getUsersByManager(managerId: string): Promise<User[]>;
  getUsersByDepartment(department: string): Promise<User[]>;
  createUser(user: InsertUser): Promise<{ user: User; password: string }>;
  updateUser(id: string, user: Partial<InsertUser>): Promise<User | undefined>;
  restoreUserPasswordHash(id: string, passwordHash: string): Promise<void>;
  deleteUser(id: string): Promise<boolean>;
  validatePassword(email: string, password: string): Promise<User | undefined>;
  clearNonAdminUsers(): Promise<void>;
  upsertUser(user: InsertUser): Promise<{ user: User; password: string }>;

  // Cities
  getCity(id: string): Promise<City | undefined>;
  getAllCities(): Promise<City[]>;
  getCityByName(name: string): Promise<City | undefined>;
  createCity(city: InsertCity): Promise<City>;
  updateCity(id: string, city: Partial<InsertCity>): Promise<City | undefined>;
  deleteCity(id: string): Promise<boolean>;

  // Trips
  getTrip(id: string): Promise<Trip | undefined>;
  getTripWithDetails(id: string): Promise<TripWithDetails | undefined>;
  getAllTrips(): Promise<Trip[]>;
  getTripsByEmployee(employeeId: string): Promise<Trip[]>;
  getTripsByStatus(status: TripStatus): Promise<Trip[]>;
  getTripsByCity(cityId: string): Promise<Trip[]>;
  getTripsByDateRange(startDate: string, endDate: string): Promise<Trip[]>;
  getTripsByDepartment(department: string): Promise<TripWithDetails[]>;
  getTripsByManagerSubordinates(managerId: string): Promise<TripWithDetails[]>;
  getTripsForApproval(managerId: string): Promise<TripWithDetails[]>;
  createTrip(trip: InsertTrip): Promise<Trip>;
  updateTrip(id: string, trip: Partial<InsertTrip>): Promise<Trip | undefined>;
  deleteTrip(id: string): Promise<boolean>;
  deleteAllTrips(): Promise<void>;
  clearAllTripAndCommunicationData(): Promise<void>;

  // Approvals
  getApproval(id: string): Promise<Approval | undefined>;
  getApprovalsByTrip(tripId: string): Promise<Approval[]>;
  getApprovalsByApprover(approverId: string): Promise<Approval[]>;
  createApproval(approval: InsertApproval): Promise<Approval>;
  updateApproval(id: string, approval: Partial<InsertApproval>): Promise<Approval | undefined>;

  // Routes
  getAllRoutes(): Promise<Route[]>;
  createRoute(route: InsertRoute): Promise<Route>;
  deleteRoute(id: string): Promise<boolean>;
  getRouteByCities(cityNames: string[]): Promise<Route | undefined>;

  // Daily Allowance
  getDailyAllowance(): Promise<DailyAllowance | undefined>;
  updateDailyAllowance(amountPerNight: string): Promise<DailyAllowance>;

  // Holidays
  getAllHolidays(): Promise<Holiday[]>;
  createHoliday(holiday: InsertHoliday): Promise<Holiday>;
  updateHoliday(id: string, data: Partial<InsertHoliday>): Promise<Holiday | undefined>;
  deleteHoliday(id: string): Promise<boolean>;

  // Contact Messages
  saveContactMessage(msg: Omit<InsertContactMessage, "isRead">): Promise<ContactMessage>;
  getAllContactMessages(): Promise<ContactMessage[]>;
  markMessageAsRead(id: string): Promise<void>;
  getUnreadMessageCount(): Promise<number>;
  // Chat messages
  saveChatMessage(message: InsertChatMessage): Promise<ChatMessage>;
  getChatMessagesBetweenUsers(firstUserId: string, secondUserId: string): Promise<ChatMessage[]>;
  getAllChatMessages(): Promise<ChatMessage[]>;
  getUnreadChatMessages(userId: string): Promise<ChatMessage[]>;
  getUnreadChatMessageCount(userId: string): Promise<number>;
  markChatMessagesAsRead(recipientId: string, senderId: string): Promise<void>;
}

export class PostgresStorage implements IStorage {
  private initialized = false;
  private chatTableReady?: Promise<void>;
  private tripBookingColumnsReady?: Promise<void>;
  private tripTypeColumnsReady?: Promise<void>;
  private tripMemoColumnsReady?: Promise<void>;

  constructor() {
    this.initializeSampleData();
    this.fixInvalidRoles();
  }

  private generatePassword(): string {
    return Math.random().toString(36).slice(2, 10);
  }

  private hashPassword(password: string): string {
    const salt = randomBytes(16).toString("hex");
    const hash = scryptSync(password, salt, 64).toString("hex");
    return `scrypt$${salt}$${hash}`;
  }

  private verifyPassword(password: string, storedPassword: string): boolean {
    // Existing accounts used SHA-256. Keep them valid until their next password change.
    if (/^[a-f0-9]{64}$/i.test(storedPassword)) {
      const candidate = createHash("sha256").update(password).digest("hex");
      return timingSafeEqual(Buffer.from(candidate, "hex"), Buffer.from(storedPassword, "hex"));
    }

    const [algorithm, salt, storedHash] = storedPassword.split("$");
    if (algorithm !== "scrypt" || !salt || !storedHash) return false;
    const candidate = scryptSync(password, salt, 64);
    const expected = Buffer.from(storedHash, "hex");
    return expected.length === candidate.length && timingSafeEqual(candidate, expected);
  }

  private sortUsersByFullName(records: User[]): User[] {
    return records.sort((first, second) => first.fullName.localeCompare(second.fullName, "ru"));
  }

  private ensureChatTable(): Promise<void> {
    if (!this.chatTableReady) {
      this.chatTableReady = db.execute(sql`
        CREATE TABLE IF NOT EXISTS trip_planner_chat_messages (
          id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
          from_user_id varchar NOT NULL,
          to_user_id varchar NOT NULL,
          message text NOT NULL,
          is_read text NOT NULL DEFAULT 'false',
          created_at timestamp NOT NULL DEFAULT now()
        )
      `).then(() => undefined);
    }
    return this.chatTableReady;
  }

  private ensureTripBookingColumns(): Promise<void> {
    if (!this.tripBookingColumnsReady) {
      this.tripBookingColumnsReady = db.execute(sql`
        ALTER TABLE trip_planner_trips
          ADD COLUMN IF NOT EXISTS trivio_booking_number text,
          ADD COLUMN IF NOT EXISTS trivio_booking_url text
      `).then(() => undefined);
    }
    return this.tripBookingColumnsReady;
  }

  private ensureTripTypeColumns(): Promise<void> {
    if (!this.tripTypeColumnsReady) {
      this.tripTypeColumnsReady = db.execute(sql`
        ALTER TABLE trip_planner_trips
          ADD COLUMN IF NOT EXISTS trip_type text NOT NULL DEFAULT 'planned',
          ADD COLUMN IF NOT EXISTS unplanned_reason text
      `).then(() => undefined);
    }
    return this.tripTypeColumnsReady;
  }

  private ensureTripMemoColumns(): Promise<void> {
    if (!this.tripMemoColumnsReady) {
      this.tripMemoColumnsReady = db.execute(sql`
        ALTER TABLE trip_planner_trips
          ADD COLUMN IF NOT EXISTS source_trip_id varchar,
          ADD COLUMN IF NOT EXISTS memo_type text
      `).then(() => undefined);
    }
    return this.tripMemoColumnsReady;
  }

  private determineRoleFromJobTitle(jobTitle: string | undefined | null): string | null {
    if (!jobTitle) return null;
    
    const jobLower = jobTitle.trim().toLowerCase();
    
    // Admin
    if (jobLower === "администратор") {
      return "admin";
    }
    
    // CEO (General Director)
    if (jobLower.includes("генеральный директор")) {
      return "ceo";
    }
    
    // Deputy CEO
    if (jobLower.includes("заместитель генерального")) {
      return "deputy_ceo";
    }
    
    // Marketing Director
    if (jobLower.includes("директор") && jobLower.includes("маркетинг")) {
      return "marketing_director";
    }
    
    // Sales Director
    if (jobLower.includes("директор") && jobLower.includes("продаж")) {
      return "sales_director";
    }
    
    // Commerce Director
    if (jobLower.includes("коммерческий директор")) {
      return "commerce_director";
    }
    
    // Regional Director (maps to sales_director since no regional_director role)
    if (jobLower.includes("региональный директор")) {
      return "sales_director";
    }
    
    // Territorial Managers — only "Территориальный менеджер" (NOT медицинский представитель)
    if (jobLower.includes("территориальный менеджер")) {
      return "territorial_manager";
    }
    
    // Commercial Manager
    if (jobLower.includes("коммерческий") && jobLower.includes("менеджер")) {
      return "commercial_manager";
    }
    
    // Product Manager / Brand Manager
    if (jobLower.includes("продакт") || jobLower.includes("бренд-менеджер")) {
      return "product_manager";
    }
    
    // KAM
    if (jobLower.includes("км") || jobLower.includes("ключевой")) {
      return "kam";
    }
    
    // No specific role found
    return null;
  }

  private readonly VALID_ROLES = [
    "admin", "coordinator", "accountant", "medical_rep", "manager", "hr_director", "territorial_manager",
    "commercial_manager", "marketing_director", "sales_director", "commerce_director", "product_manager", "kam", "ceo", "deputy_ceo"
  ];

  private resolveRole(providedRole: string | null | undefined, jobTitle: string | null | undefined): string | null {
    if (providedRole && this.VALID_ROLES.includes(providedRole)) {
      return providedRole;
    }
    // Provided role is invalid or missing — re-calculate from job title
    return this.determineRoleFromJobTitle(jobTitle);
  }

  // Job title patterns that should NOT be mapped to territorial_manager
  private readonly NON_TM_PATTERNS = [
    "медицинский представитель",
    "национальный менеджер",
    "региональный менеджер",
  ];

  private async fixInvalidRoles() {
    try {
      const allUsers = await db.select().from(users);
      for (const user of allUsers) {
        const jobLower = (user.jobTitle || "").toLowerCase();

        // Revert wrongly assigned territorial_manager for non-TM job titles
        if (user.role === "territorial_manager" && this.NON_TM_PATTERNS.some(p => jobLower.includes(p))) {
          await db.update(users).set({ role: "medical_rep" as any }).where(eq(users.id, user.id));
          console.log(`[STORAGE] Reverted role: ${user.fullName} | territorial_manager → medical_rep (jobTitle: "${user.jobTitle}")`);
          continue;
        }

        // Fix other invalid roles using job title detection
        if (user.role && !this.VALID_ROLES.includes(user.role)) {
          const newRole = this.determineRoleFromJobTitle(user.jobTitle);
          if (newRole !== null) {
            await db.update(users).set({ role: newRole as any }).where(eq(users.id, user.id));
            console.log(`[STORAGE] Fixed role: ${user.fullName} | ${user.role} → ${newRole} (jobTitle: "${user.jobTitle}")`);
          }
        }
      }
    } catch (err) {
      console.error("[STORAGE] fixInvalidRoles error:", err);
    }
  }

  private async initializeSampleData() {
    if (this.initialized) return;
    this.initialized = true;

    try {
      await this.ensureChatTable();
      await this.ensureTripBookingColumns();
      await this.ensureTripTypeColumns();
      await this.ensureTripMemoColumns();

      // Create cities if not exist
      const citiesCount = await db.select().from(cities);
      if (citiesCount.length === 0) {
        await db.insert(cities).values([
          { name: "Москва", region: "Управление продаж" },
          { name: "Красноярск", region: "Сибирский" },
          { name: "Казань", region: "Волжский" },
          { name: "Новосибирск", region: "Сибирский" },
          { name: "Самара", region: "Волжский" },
          { name: "Ростов-на-Дону", region: "Южный" },
        ]);
        console.log(`[INIT] Cities created`);
      }

      // Create routes if not exist
      const routesCount = await db.select().from(routes);
      if (routesCount.length === 0) {
        await db.insert(routes).values([
          {
            path: "Москва-Владимир-Гусь Хрустальный-Москва",
            distance: "346 км",
            cities: ["Москва", "Владимир", "Гусь Хрустальный", "Москва"],
            kilometers: "346",
          },
          {
            path: "Красноярск - Козулька - Новоселово - Знаменка - Белый Яр - Минусинск - Абакан - Черногорск - Усть-Абакан - Красноярск",
            distance: "1016 км",
            cities: ["Красноярск", "Козулька", "Новоселово", "Знаменка", "Белый Яр", "Минусинск", "Абакан", "Черногорск", "Усть-Абакан", "Красноярск"],
            kilometers: "1016",
          },
        ]);
        console.log(`[INIT] Routes created`);
      }

      // Create daily allowance if not exist
      const daCount = await db.select().from(dailyAllowance);
      if (daCount.length === 0) {
        await db.insert(dailyAllowance).values({
          amountPerNight: "1700",
        });
        console.log(`[INIT] Daily allowance created`);
      }

      console.log(`[STORAGE] PostgreSQL initialized`);
    } catch (error) {
      console.error("[INIT] Error initializing sample data:", error);
    }
  }

  // Users
  async getUser(id: string): Promise<User | undefined> {
    const result = await db.select().from(users).where(eq(users.id, id)).limit(1);
    return result[0];
  }

  async getUserByEmail(email: string): Promise<User | undefined> {
    const result = await db.select().from(users).where(eq(users.email, email)).limit(1);
    return result[0];
  }

  async getAllUsers(): Promise<User[]> {
    return this.sortUsersByFullName(await db.select().from(users));
  }

  async getUsersByRole(role: string): Promise<User[]> {
    return this.sortUsersByFullName(await db.select().from(users).where(eq(users.role, role as any)));
  }

  async getUsersByManager(managerId: string): Promise<User[]> {
    return this.sortUsersByFullName(await db.select().from(users).where(eq(users.managerId, managerId)));
  }

  async getUsersByDepartment(department: string): Promise<User[]> {
    return this.sortUsersByFullName(await db.select().from(users).where(eq(users.department, department)));
  }

  async createUser(user: InsertUser): Promise<{ user: User; password: string }> {
    const id = randomUUID();
    const password = this.generatePassword();
    const hashedPassword = this.hashPassword(password);

    // Determine role: validate provided role, re-calculate from jobTitle if invalid
    const role = this.resolveRole(user.role as string | null, user.jobTitle) as UserRole | null;

    const newUser: User = {
      id: id as string,
      fullName: user.fullName,
      email: user.email,
      password: hashedPassword,
      role,
      jobTitle: user.jobTitle ?? null,
      userType: user.userType,
      managerId: user.managerId ?? null,
      managerName: user.managerName ?? null,
      department: user.department ?? null,
      createdAt: new Date(),
    };

    await db.insert(users).values(newUser as any);
    return { user: newUser, password };
  }

  async updateUser(id: string, user: Partial<InsertUser>): Promise<User | undefined> {
    const updateData: any = { ...user };
    if (updateData.password) {
      updateData.password = this.hashPassword(updateData.password);
    }

    await db.update(users).set(updateData).where(eq(users.id, id));
    return this.getUser(id);
  }

  async restoreUserPasswordHash(id: string, passwordHash: string): Promise<void> {
    await db.update(users).set({ password: passwordHash }).where(eq(users.id, id));
  }

  async deleteUser(id: string): Promise<boolean> {
    await db.delete(users).where(eq(users.id, id));
    return true;
  }

  async validatePassword(email: string, password: string): Promise<User | undefined> {
    const user = await this.getUserByEmail(email);
    if (!user) return undefined;

    if (this.verifyPassword(password, user.password)) {
      return user;
    }
    return undefined;
  }

  async clearNonAdminUsers(): Promise<void> {
    await db.delete(users).where(ne(users.role, "admin" as any));
    console.log("[STORAGE] Cleared all non-admin users");
  }

  async upsertUser(user: InsertUser): Promise<{ user: User; password: string }> {
    const id = randomUUID();
    const password = this.generatePassword();
    const hashedPassword = this.hashPassword(password);

    // Determine role: validate provided role, re-calculate from jobTitle if invalid
    const role = this.resolveRole(user.role as string | null, user.jobTitle) as UserRole | null;

    const newUser: User = {
      id: id as string,
      fullName: user.fullName,
      email: user.email,
      password: hashedPassword,
      role,
      jobTitle: user.jobTitle ?? null,
      userType: user.userType,
      managerId: user.managerId ?? null,
      managerName: user.managerName ?? null,
      department: user.department ?? null,
      createdAt: new Date(),
    };

    // Use Drizzle UPSERT to handle duplicates
    const result = await db
      .insert(users)
      .values(newUser as any)
      .onConflictDoUpdate({
        target: users.email,
        set: {
          fullName: user.fullName,
          role: role as any,
          jobTitle: user.jobTitle,
          userType: user.userType,
          managerId: user.managerId || null,
          managerName: user.managerName || null,
          department: user.department || null,
          password: hashedPassword,
        },
      })
      .returning();

    const upsertedUser = result[0];
    return { user: upsertedUser, password };
  }

  // Cities
  async getCity(id: string): Promise<City | undefined> {
    const result = await db.select().from(cities).where(eq(cities.id, id)).limit(1);
    return result[0];
  }

  async getAllCities(): Promise<City[]> {
    return db.select().from(cities);
  }

  async getCityByName(name: string): Promise<City | undefined> {
    const result = await db.select().from(cities).where(eq(cities.name, name)).limit(1);
    return result[0];
  }

  async createCity(city: InsertCity): Promise<City> {
    const id = randomUUID();
    const newCity = {
      id: id as string,
      ...city,
      createdAt: new Date(),
    };
    await db.insert(cities).values(newCity as any);
    return newCity as City;
  }

  async updateCity(id: string, city: Partial<InsertCity>): Promise<City | undefined> {
    await db.update(cities).set(city).where(eq(cities.id, id));
    return this.getCity(id);
  }

  async deleteCity(id: string): Promise<boolean> {
    await db.delete(cities).where(eq(cities.id, id));
    return true;
  }

  // Trips
  async getTrip(id: string): Promise<Trip | undefined> {
    const result = await db.select().from(trips).where(eq(trips.id, id)).limit(1);
    return result[0];
  }

  async getTripWithDetails(id: string): Promise<TripWithDetails | undefined> {
    const trip = await this.getTrip(id);
    if (!trip) return undefined;

    const employee = await this.getUser(trip.employeeId);
    const city = trip.cityId ? await this.getCity(trip.cityId) : undefined;
    const route = await db.select().from(routes).where(eq(routes.id, trip.routeId)).limit(1);
    const approvalsList = await this.getApprovalsByTrip(trip.id);

    // Enrich each approval with approver info
    const approvalsWithApprovers = await Promise.all(
      approvalsList.map(async (approval) => {
        const approver = await this.getUser(approval.approverId);
        return {
          ...approval,
          approver: approver ? { id: approver.id, fullName: approver.fullName, jobTitle: approver.jobTitle } : undefined,
        };
      })
    );

    return {
      ...trip,
      employee: employee!,
      city,
      route: route[0]!,
      approvals: approvalsWithApprovers,
    };
  }

  async getAllTrips(): Promise<Trip[]> {
    return db.select().from(trips);
  }

  async getTripsByEmployee(employeeId: string): Promise<Trip[]> {
    return db.select().from(trips).where(eq(trips.employeeId, employeeId));
  }

  async getTripsByStatus(status: TripStatus): Promise<Trip[]> {
    return db.select().from(trips).where(eq(trips.status, status));
  }

  async getTripsByCity(cityId: string): Promise<Trip[]> {
    return db.select().from(trips).where(eq(trips.cityId, cityId));
  }

  async getTripsByDateRange(startDate: string, endDate: string): Promise<Trip[]> {
    return db.select().from(trips);
  }

  async getTripsByDepartment(department: string): Promise<TripWithDetails[]> {
    const allTrips = await this.getAllTrips();
    const result: TripWithDetails[] = [];

    for (const trip of allTrips) {
      const employee = await this.getUser(trip.employeeId);
      if (employee && employee.department === department) {
        const details = await this.getTripWithDetails(trip.id);
        if (details) {
          result.push(details);
        }
      }
    }

    return result;
  }

  async getTripsByManagerSubordinates(managerId: string): Promise<TripWithDetails[]> {
    const subordinates = await this.getUsersByManager(managerId);
    const result: TripWithDetails[] = [];
    for (const sub of subordinates) {
      const subTrips = await this.getTripsByEmployee(sub.id);
      for (const trip of subTrips) {
        const details = await this.getTripWithDetails(trip.id);
        if (details) result.push(details);
      }
    }
    return result;
  }

  async getTripsForApproval(managerId: string): Promise<TripWithDetails[]> {
    const allTrips = await this.getAllTrips();
    const result: TripWithDetails[] = [];
    const manager = await this.getUser(managerId);
    if (!manager) return result;
    const isDepartmentLeader = manager.role != null && ["sales_director", "commerce_director", "marketing_director"].includes(manager.role);
    const isCeoOrAdmin = manager.role != null && ["ceo", "deputy_ceo", "admin"].includes(manager.role);

    // Statuses relevant for each role level:
    // TM: sees "pending" (employee submitted, waiting for TM)
    // Director: sees "pending" (no TM in chain) + "manager_approved" (TM approved, waiting for director)
    // CEO/Admin: sees all non-final statuses
    // Each role sees trips they need to act on PLUS trips they have already acted on
    const relevantStatuses: string[] = isCeoOrAdmin
      ? ["pending", "manager_approved", "director_approved", "approved", "rejected"]
      : ["pending", "manager_approved", "director_approved", "approved", "rejected"];

    for (const trip of allTrips) {
      if (!relevantStatuses.includes(trip.status)) continue;

      const details = await this.getTripWithDetails(trip.id);
      if (!details) continue;
      const employee = details.employee;
      if (!employee) continue;

      if (isCeoOrAdmin) {
        // Администратор и CEO видят все поездки всех сотрудников включая свои
        result.push(details);
      } else if (isDepartmentLeader) {
        // Руководитель отдела видит сотрудников своего отдела и прямых подчинённых.
        if (employee.id !== managerId && (employee.managerId === managerId || employee.department === manager.department)) {
          result.push(details);
        }
      } else if (manager.userType === "manager") {
        // Менеджер видит только прямых подчинённых (managerId = manager.id).
        if (employee.managerId === managerId) {
          result.push(details);
        }
      }
    }

    return result;
  }

  async createTrip(trip: InsertTrip): Promise<Trip> {
    const id = randomUUID();
    const newTrip = {
      id: id as string,
      ...trip,
      status: (trip.status || "draft") as TripStatus,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    await db.insert(trips).values(newTrip as any);
    return newTrip as Trip;
  }

  async updateTrip(id: string, trip: Partial<InsertTrip>): Promise<Trip | undefined> {
    const updateData = { ...trip, updatedAt: new Date() } as any;
    await db.update(trips).set(updateData).where(eq(trips.id, id));
    return this.getTrip(id);
  }

  async deleteTrip(id: string): Promise<boolean> {
    await db.delete(trips).where(eq(trips.id, id));
    return true;
  }

  async deleteAllTrips(): Promise<void> {
    await db.delete(trips);
  }

  async clearAllTripAndCommunicationData(): Promise<void> {
    await this.ensureChatTable();
    await db.transaction(async (tx) => {
      await tx.delete(approvals);
      await tx.delete(chatMessages);
      await tx.delete(contactMessages);
      await tx.delete(trips);
    });
  }

  // Approvals
  async getApproval(id: string): Promise<Approval | undefined> {
    const result = await db.select().from(approvals).where(eq(approvals.id, id)).limit(1);
    return result[0];
  }

  async getApprovalsByTrip(tripId: string): Promise<Approval[]> {
    return db.select().from(approvals).where(eq(approvals.tripId, tripId));
  }

  async getApprovalsByApprover(approverId: string): Promise<Approval[]> {
    return db.select().from(approvals).where(eq(approvals.approverId, approverId));
  }

  async createApproval(approval: InsertApproval): Promise<Approval> {
    const id = randomUUID();
    const newApproval = {
      id: id as string,
      ...approval,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    await db.insert(approvals).values(newApproval as any);
    return newApproval as Approval;
  }

  async updateApproval(id: string, approval: Partial<InsertApproval>): Promise<Approval | undefined> {
    const updateData = { ...approval, updatedAt: new Date() } as any;
    await db.update(approvals).set(updateData).where(eq(approvals.id, id));
    return this.getApproval(id);
  }

  // Routes
  async getAllRoutes(): Promise<Route[]> {
    return db.select().from(routes);
  }

  async createRoute(route: InsertRoute): Promise<Route> {
    const id = randomUUID();
    const newRoute: Route = {
      id,
      ...route,
      createdAt: new Date(),
    };
    await db.insert(routes).values(newRoute);
    return newRoute;
  }

  async deleteRoute(id: string): Promise<boolean> {
    await db.delete(routes).where(eq(routes.id, id));
    return true;
  }

  async getRouteByCities(cityNames: string[]): Promise<Route | undefined> {
    const allRoutes = await this.getAllRoutes();
    return allRoutes.find(r => 
      Array.isArray(r.cities) && cityNames.every(city => r.cities.includes(city))
    );
  }

  // Daily Allowance
  async getDailyAllowance(): Promise<DailyAllowance | undefined> {
    const result = await db.select().from(dailyAllowance).limit(1);
    return result[0];
  }

  async updateDailyAllowance(amountPerNight: string): Promise<DailyAllowance> {
    const existing = await this.getDailyAllowance();
    if (existing) {
      await db.update(dailyAllowance)
        .set({ amountPerNight, updatedAt: new Date() })
        .where(eq(dailyAllowance.id, existing.id));
      return { ...existing, amountPerNight, updatedAt: new Date() };
    }

    const id = randomUUID();
    const newDA: DailyAllowance = {
      id,
      amountPerNight,
      updatedAt: new Date(),
    };
    await db.insert(dailyAllowance).values(newDA);
    return newDA;
  }

  // Holidays
  async getAllHolidays(): Promise<Holiday[]> {
    return db.select().from(holidays);
  }

  async createHoliday(holiday: InsertHoliday): Promise<Holiday> {
    const id = randomUUID();
    const newHoliday = {
      id: id as string,
      ...holiday,
      createdAt: new Date(),
    };
    await db.insert(holidays).values(newHoliday as any);
    return newHoliday as Holiday;
  }

  async updateHoliday(id: string, data: Partial<InsertHoliday>): Promise<Holiday | undefined> {
    await db.update(holidays).set(data).where(eq(holidays.id, id));
    const result = await db.select().from(holidays).where(eq(holidays.id, id)).limit(1);
    return result[0];
  }

  async deleteHoliday(id: string): Promise<boolean> {
    await db.delete(holidays).where(eq(holidays.id, id));
    return true;
  }

  async saveContactMessage(msg: Omit<InsertContactMessage, "isRead">): Promise<ContactMessage> {
    const newMsg: ContactMessage = {
      id: randomUUID(),
      ...msg,
      attachmentUrl: msg.attachmentUrl ?? null,
      attachmentName: msg.attachmentName ?? null,
      attachmentContentType: msg.attachmentContentType ?? null,
      isRead: "false",
      createdAt: new Date(),
    };
    await db.insert(contactMessages).values(newMsg as any);
    return newMsg;
  }

  async getAllContactMessages(): Promise<ContactMessage[]> {
    return db.select().from(contactMessages).orderBy(sql`created_at DESC`);
  }

  async markMessageAsRead(id: string): Promise<void> {
    await db.update(contactMessages).set({ isRead: "true" }).where(eq(contactMessages.id, id));
  }

  async getUnreadMessageCount(): Promise<number> {
    const result = await db.select({ count: sql<number>`count(*)` })
      .from(contactMessages)
      .where(eq(contactMessages.isRead, "false"));
    return Number(result[0]?.count ?? 0);
  }

  async clearContactMessages(): Promise<void> {
    await db.delete(contactMessages);
  }

  async saveChatMessage(message: InsertChatMessage): Promise<ChatMessage> {
    await this.ensureChatTable();
    const newMessage: ChatMessage = {
      id: randomUUID(),
      ...message,
      isRead: "false",
      createdAt: new Date(),
    };
    await db.insert(chatMessages).values(newMessage as any);
    return newMessage;
  }

  async getChatMessagesBetweenUsers(firstUserId: string, secondUserId: string): Promise<ChatMessage[]> {
    await this.ensureChatTable();
    return db.select()
      .from(chatMessages)
      .where(sql`(from_user_id = ${firstUserId} AND to_user_id = ${secondUserId}) OR (from_user_id = ${secondUserId} AND to_user_id = ${firstUserId})`)
      .orderBy(sql`created_at ASC`);
  }

  async getAllChatMessages(): Promise<ChatMessage[]> {
    await this.ensureChatTable();
    return db.select().from(chatMessages).orderBy(sql`created_at DESC`);
  }

  async getUnreadChatMessages(userId: string): Promise<ChatMessage[]> {
    await this.ensureChatTable();
    return db.select()
      .from(chatMessages)
      .where(sql`to_user_id = ${userId} AND is_read = 'false'`)
      .orderBy(sql`created_at DESC`);
  }

  async getUnreadChatMessageCount(userId: string): Promise<number> {
    await this.ensureChatTable();
    const result = await db.select({ count: sql<number>`count(*)` })
      .from(chatMessages)
      .where(sql`to_user_id = ${userId} AND is_read = 'false'`);
    return Number(result[0]?.count ?? 0);
  }

  async markChatMessagesAsRead(recipientId: string, senderId: string): Promise<void> {
    await this.ensureChatTable();
    await db.update(chatMessages)
      .set({ isRead: "true" })
      .where(sql`to_user_id = ${recipientId} AND from_user_id = ${senderId} AND is_read = 'false'`);
  }
}

export const storage = new PostgresStorage();
