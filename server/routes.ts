import type { Express } from "express";
import { createServer, type Server } from "http";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "crypto";
import { storage } from "./storage";
import { 
  insertUserSchema, 
  insertCitySchema, 
  insertTripSchema, 
  insertApprovalSchema,
  insertRouteSchema,
  insertDailyAllowanceSchema,
  insertHolidaySchema,
  type Trip,
  type User,
  type TripStatus 
} from "@shared/schema";
import { sendEmail, generateChatNotificationEmail, generateCredentialEmail, generatePasswordResetEmail, generateContactAdminEmail } from "./email-service";
import { generateRandomPassword, validatePassword } from "./password-utils";
import { generateTripMemo, type TripMemoKind } from "./trip-memo-generator";

export async function registerRoutes(app: Express): Promise<Server> {
  const attachmentsDir = path.resolve(import.meta.dirname, "..", "uploads", "contact-screenshots");
  if (!fs.existsSync(attachmentsDir)) {
    fs.mkdirSync(attachmentsDir, { recursive: true });
  }
  app.use("/uploads/contact-screenshots", (req, res, next) => {
    const fileName = decodeURIComponent(req.path).replace(/^\/+/, "");
    const filePath = path.join(attachmentsDir, fileName);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: "File not found" });
    }
    return res.sendFile(filePath);
  });
  async function readMultipartFields(req: any): Promise<{ subject?: string; message?: string; attachment?: { filename?: string; mimetype?: string; buffer?: Buffer } | null }> {
    const contentType = req.headers["content-type"] || "";
    const match = /boundary=([^;]+)/i.exec(contentType);
    if (!match) return {};
    const boundary = `--${match[1]}`;
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    const body = Buffer.concat(chunks);
    const parts = body.toString("binary").split(boundary).slice(1, -1);
    const result: { subject?: string; message?: string; attachment?: { filename?: string; mimetype?: string; buffer?: Buffer } | null } = {};
    for (const part of parts) {
      const headerEnd = part.indexOf("\r\n\r\n");
      if (headerEnd === -1) continue;
      const headers = part.slice(0, headerEnd);
      const nameMatch = /name="([^"]+)"/i.exec(headers);
      if (!nameMatch) continue;
      const fieldName = nameMatch[1];
      const value = part.slice(headerEnd + 4, part.lastIndexOf("\r\n"));
      if (fieldName === "subject") result.subject = Buffer.from(value, "binary").toString("utf8");
      if (fieldName === "message") result.message = Buffer.from(value, "binary").toString("utf8");
      if (fieldName === "attachment") {
        const fileNameMatch = /filename="([^"]*)"/i.exec(headers);
        const typeMatch = /content-type:\s*([^\r\n]+)/i.exec(headers);
        result.attachment = {
          filename: fileNameMatch?.[1],
          mimetype: typeMatch?.[1],
          buffer: Buffer.from(value, "binary"),
        };
      }
    }
    return result;
  }

  function cleanupOldAttachments() {
    const cutoff = Date.now() - 10 * 24 * 60 * 60 * 1000;
    for (const name of fs.readdirSync(attachmentsDir)) {
      const filePath = path.join(attachmentsDir, name);
      const stat = fs.statSync(filePath);
      if (stat.mtimeMs < cutoff) fs.rmSync(filePath, { force: true });
    }
  }

  function attachmentUrl(filename: string) {
    return `/uploads/contact-screenshots/${filename}`;
  }

  function isValidTrivioBookingUrl(value: string | null | undefined) {
    if (!value) return true;
    try {
      const url = new URL(value);
      return url.protocol === "https:" && (url.hostname === "trivio.ru" || url.hostname.endsWith(".trivio.ru"));
    } catch {
      return false;
    }
  }

  const elevatedTripViewerRoles = new Set(["admin", "ceo", "deputy_ceo"]);
  const allTripsViewerRoles = new Set(["admin", "ceo", "deputy_ceo", "coordinator"]);
  const departmentLeaderRoles = new Set(["marketing_director", "sales_director", "commerce_director"]);

  async function getVisibleTripsForUser(user: User): Promise<Trip[]> {
    const allTrips = await storage.getAllTrips();
    if (allTripsViewerRoles.has(user.role || "")) return allTrips;

    const allowedEmployeeIds = new Set([user.id]);
    if (user.userType === "manager") {
      const allUsers = await storage.getAllUsers();
      for (const candidate of allUsers) {
        if (candidate.managerId === user.id) allowedEmployeeIds.add(candidate.id);
        if (departmentLeaderRoles.has(user.role || "") && user.department && candidate.department === user.department) {
          allowedEmployeeIds.add(candidate.id);
        }
      }
    }

    return allTrips.filter((trip) => allowedEmployeeIds.has(trip.employeeId));
  }

  async function applyTripFilters(trips: Trip[], query: Record<string, unknown>): Promise<Trip[]> {
    const employeeId = typeof query.employeeId === "string" ? query.employeeId : undefined;
    const status = typeof query.status === "string" ? query.status : undefined;
    const cityId = typeof query.cityId === "string" ? query.cityId : undefined;
    const department = typeof query.department === "string" ? query.department : undefined;
    let filtered = trips;

    if (employeeId) filtered = filtered.filter((trip) => trip.employeeId === employeeId);
    if (status) filtered = filtered.filter((trip) => trip.status === status);
    if (cityId) filtered = filtered.filter((trip) => trip.cityId === cityId);
    if (department) {
      const departmentUsers = await storage.getUsersByDepartment(department);
      const departmentUserIds = new Set(departmentUsers.map((candidate) => candidate.id));
      filtered = filtered.filter((trip) => departmentUserIds.has(trip.employeeId));
    }
    return filtered;
  }

  // ============ AUTH ============
  
  // Login
  app.post("/api/auth/login", async (req, res) => {
    try {
      console.log("[AUTH] Login attempt received");
      const { email, password } = req.body;
      console.log(`[AUTH] Email: ${email}, Password length: ${password?.length || 0}`);
      
      if (!email || !password) {
        console.error("[AUTH] Missing email or password");
        return res.status(400).json({ error: "Email and password required" });
      }

      const user = await storage.validatePassword(email, password);
      if (!user) {
        console.error(`[AUTH] Login failed for ${email} - invalid credentials`);
        return res.status(401).json({ error: "Invalid email or password" });
      }

      req.session.userId = user.id;
      console.log(`[AUTH] Session userId set to: ${user.id}, sessionID: ${req.sessionID}`);
      console.log(`[AUTH] Setting cookie with path: ${req.session.cookie.path}, secure: ${req.session.cookie.secure}, httpOnly: ${req.session.cookie.httpOnly}`);
      const { password: _, ...userWithoutPassword } = user;
      console.log(`[AUTH] User logged in: ${email}`);
      
      // Save session to ensure it persists
      req.session.save((err) => {
        if (err) {
          console.error("[AUTH] Session save error:", err);
          return res.status(500).json({ error: "Session save failed" });
        }
        console.log(`[AUTH] Session saved successfully, sessionID: ${req.sessionID}`);
        // Also return sessionId for clients that can't store cookies (iframe environments)
        res.json({ ...userWithoutPassword, sessionId: req.sessionID });
      });
    } catch (error) {
      console.error("[AUTH] Login error:", error);
      res.status(500).json({ error: "Login failed" });
    }
  });

  // Logout
  app.post("/api/auth/logout", async (req, res) => {
    req.session.destroy((err) => {
      if (err) {
        return res.status(500).json({ error: "Logout failed" });
      }
      res.json({ success: true });
    });
  });

  // Get session
  app.get("/api/auth/session", async (req, res) => {
    try {
      if (!req.session.userId) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      const user = await storage.getUser(req.session.userId);
      if (!user) {
        return res.status(401).json({ error: "User not found" });
      }

      const { password: _, ...userWithoutPassword } = user;
      res.json(userWithoutPassword);
    } catch (error) {
      res.status(500).json({ error: "Session check failed" });
    }
  });

  // Switch user (admin only for testing)
  app.post("/api/auth/switch-user", async (req, res) => {
    try {
      console.log(`[AUTH] Switch user request: sessionId=${req.sessionID}, userId=${req.session?.userId}`);
      
      const { userId } = req.body;
      if (!userId) {
        return res.status(400).json({ error: "User ID required" });
      }

      // Check if current user is admin
      if (!req.session?.userId) {
        console.log("[AUTH] Switch user BLOCKED: No session userId");
        return res.status(401).json({ error: "Not authenticated" });
      }

      const adminUser = await storage.getUser(req.session.userId);
      console.log(`[AUTH] Admin check: adminUser=${adminUser?.email}, role=${adminUser?.role}`);
      
      if (!adminUser || !["admin", "coordinator"].includes(adminUser.role || "")) {
        return res.status(403).json({ error: "Only administrators or coordinators can switch users" });
      }

      // Get the target user
      const targetUser = await storage.getUser(userId);
      if (!targetUser) {
        return res.status(404).json({ error: "User not found" });
      }
      if (adminUser.role === "coordinator" && targetUser.userType === "manager") {
        return res.status(403).json({ error: "Coordinator can switch only to employee test accounts" });
      }

      // Switch session to target user
      req.session.userId = userId;
      const { password: _, ...userWithoutPassword } = targetUser;
      console.log(`[AUTH] Admin switched to user: ${targetUser.email}`);
      
      // CRITICAL: Save session to ensure Set-Cookie header is sent
      req.session.save((err) => {
        if (err) {
          console.error("[AUTH] Switch user session save error:", err);
          return res.status(500).json({ error: "Session save failed" });
        }
        console.log(`[AUTH] Session saved successfully for userId=${userId}`);
        res.json(userWithoutPassword);
      });
    } catch (error) {
      console.error("[AUTH] Switch user error:", error);
      res.status(500).json({ error: "Switch user failed" });
    }
  });

  // ============ USERS ============
  
  // Get all users (role-aware: each role sees only their scope)
  app.get("/api/users", async (req, res) => {
    try {
      const { department } = req.query;
      const currentUser = req.session.userId ? await storage.getUser(req.session.userId) : null;
      let users: User[];

      // Helper: dedupe by id
      const deduped = (arr: User[]) =>
        Array.from(new Map(arr.map(u => [u.id, u])).values());

      if (!currentUser) {
        // Unauthenticated — return empty
        return res.json([]);
      }

      const role = currentUser.role;
      const utype = currentUser.userType;

      if (role === "admin" || role === "ceo" || role === "coordinator") {
        // Full visibility
        users = await storage.getAllUsers();

      } else if (role === "territorial_manager") {
        // ТМ: себя + прямые подчинённые (МП) + менеджер (для отображения имени)
        const subordinates = await storage.getUsersByManager(currentUser.id);
        const base = subordinates.some(u => u.id === currentUser.id)
          ? subordinates
          : [currentUser, ...subordinates];
        if (currentUser.managerId && !base.some(u => u.id === currentUser.managerId)) {
          const mgr = await storage.getUser(currentUser.managerId);
          users = mgr ? [...base, mgr] : base;
        } else {
          users = base;
        }

      } else if (utype === "manager") {
        // Руководитель отдела (директор, зам. директора и т.п.):
        // Себя + прямые подчинённые + подчинённые подчинённых (2 уровня → охватывает ТМ → МП)
        const directSubs = await storage.getUsersByManager(currentUser.id);
        const level2: typeof directSubs = [];
        for (const sub of directSubs) {
          const subSubs = await storage.getUsersByManager(sub.id);
          level2.push(...subSubs);
        }
        users = deduped([currentUser, ...directSubs, ...level2]);

      } else if (utype === "employee" && currentUser.managerId) {
        // Рядовой сотрудник (МП и т.п.):
        // Себя + менеджер + коллеги (сотрудники с тем же manager_id)
        const siblings = await storage.getUsersByManager(currentUser.managerId);
        const mgr = await storage.getUser(currentUser.managerId);
        const base = mgr ? [mgr, ...siblings] : [...siblings];
        users = deduped(base.some(u => u.id === currentUser.id) ? base : [...base, currentUser]);

      } else if (department) {
        users = await storage.getUsersByDepartment(department as string);

      } else {
        users = await storage.getAllUsers();
      }

      res.json(users.sort((first, second) => first.fullName.localeCompare(second.fullName, "ru")));
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch users" });
    }
  });

  // Get user by ID
  app.get("/api/users/:id", async (req, res) => {
    try {
      const user = await storage.getUser(req.params.id);
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }
      res.json(user);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch user" });
    }
  });

  // Middleware to check if user is admin
  const requireAdmin = async (req: any, res: any, next: any) => {
    try {
      console.log(`[AUTH] requireAdmin check - session.userId: ${req.session.userId}, session.id: ${req.sessionID}`);
      
      if (!req.session.userId) {
        console.log(`[AUTH] BLOCKED: No session.userId found`);
        return res.status(401).json({ error: "Not authenticated" });
      }

      const user = await storage.getUser(req.session.userId);
      if (!user || user.role !== "admin") {
        console.log(`[AUTH] BLOCKED: User not found or not admin`);
        return res.status(403).json({ error: "Only administrators can manage users" });
      }

      console.log(`[AUTH] PASSED: Admin user verified`);
      next();
    } catch (error) {
      console.error("[AUTH] Permission check error:", error);
      res.status(500).json({ error: "Permission check failed" });
    }
  };

  // Clear non-admin users before loading new file (admin only)
  app.post("/api/users/clear-old", requireAdmin, async (req, res) => {
    try {
      await storage.clearNonAdminUsers();
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to clear users" });
    }
  });

  // Create or update user (UPSERT on email) - admin only
  app.post("/api/users", requireCoordinatorOrAdmin, async (req, res) => {
    try {
      console.log("[USERS] Create/Update user request:", JSON.stringify(req.body));
      const data = insertUserSchema.parse(req.body);
      const { user, password } = await storage.upsertUser(data);
      console.log("[USERS] User created successfully:", user.id);
      res.status(201).json({ user, password });
    } catch (error: any) {
      console.error("[USERS] Error creating user:", error);
      res.status(400).json({ error: error.message || "Failed to create user" });
    }
  });

  // Update user (admin only)
  app.patch("/api/users/:id", requireCoordinatorOrAdmin, async (req, res) => {
    try {
      const data = insertUserSchema.partial().parse(req.body);
      const user = await storage.updateUser(req.params.id, data);
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }
      res.json(user);
    } catch (error: any) {
      res.status(400).json({ error: error.message || "Failed to update user" });
    }
  });

  // Delete user (admin only)
  app.delete("/api/users/:id", requireCoordinatorOrAdmin, async (req, res) => {
    try {
      const success = await storage.deleteUser(req.params.id);
      if (!success) {
        return res.status(404).json({ error: "User not found" });
      }
      res.status(204).send();
    } catch (error) {
      res.status(500).json({ error: "Failed to delete user" });
    }
  });

  // ============ CITIES ============
  
  // Get all cities
  app.get("/api/cities", async (req, res) => {
    try {
      const cities = await storage.getAllCities();
      cities.sort((a, b) => a.name.localeCompare(b.name, "ru"));
      res.json(cities);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch cities" });
    }
  });

  // Get city by ID
  app.get("/api/cities/:id", async (req, res) => {
    try {
      const city = await storage.getCity(req.params.id);
      if (!city) {
        return res.status(404).json({ error: "City not found" });
      }
      res.json(city);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch city" });
    }
  });

  // Create city
  app.post("/api/cities", async (req, res) => {
    try {
      const data = insertCitySchema.parse(req.body);
      
      // Check for duplicate
      const existing = await storage.getCityByName(data.name);
      if (existing) {
        return res.status(409).json({ error: "City with this name already exists" });
      }
      
      const city = await storage.createCity(data);
      res.status(201).json(city);
    } catch (error: any) {
      res.status(400).json({ error: error.message || "Failed to create city" });
    }
  });

  // Update city
  app.patch("/api/cities/:id", async (req, res) => {
    try {
      const data = insertCitySchema.partial().parse(req.body);
      const city = await storage.updateCity(req.params.id, data);
      if (!city) {
        return res.status(404).json({ error: "City not found" });
      }
      res.json(city);
    } catch (error: any) {
      res.status(400).json({ error: error.message || "Failed to update city" });
    }
  });

  // Delete city
  app.delete("/api/cities/:id", async (req, res) => {
    try {
      const success = await storage.deleteCity(req.params.id);
      if (!success) {
        return res.status(404).json({ error: "City not found" });
      }
      res.status(204).send();
    } catch (error) {
      res.status(500).json({ error: "Failed to delete city" });
    }
  });

  // ============ TRIPS ============
  
  // Get all trips (with optional filters)
  app.get("/api/trips", async (req, res) => {
    try {
      const currentUser = req.session.userId ? await storage.getUser(req.session.userId) : null;
      if (!currentUser) return res.status(401).json({ error: "Not authenticated" });
      const trips = await applyTripFilters(await getVisibleTripsForUser(currentUser), req.query);
      
      // Enrich with details
      const tripsWithDetails = await Promise.all(
        trips.map(trip => storage.getTripWithDetails(trip.id))
      );
      
      res.json(tripsWithDetails.filter(t => t !== undefined));
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch trips" });
    }
  });

  // Get trip by ID
  app.get("/api/trips/:id", async (req, res) => {
    try {
      const trip = await storage.getTripWithDetails(req.params.id);
      if (!trip) {
        return res.status(404).json({ error: "Trip not found" });
      }
      res.json(trip);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch trip" });
    }
  });

  // Create trip
  app.post("/api/trips", async (req, res) => {
    try {
      const data = insertTripSchema.parse(req.body);
      if (!isValidTrivioBookingUrl(data.trivioBookingUrl)) {
        return res.status(400).json({ error: "Trivio booking link must be an HTTPS link on trivio.ru" });
      }
      const currentUser = req.session.userId ? await storage.getUser(req.session.userId) : null;
      if (data.memoType === "reschedule") {
        const sourceTrip = data.sourceTripId ? await storage.getTrip(data.sourceTripId) : undefined;
        if (data.tripType !== "unplanned" || !sourceTrip || sourceTrip.employeeId !== data.employeeId) {
          return res.status(400).json({ error: "Для переноса выберите свою ранее созданную командировку" });
        }
      }

      // Check for overlapping trips
      const existingTrips = await storage.getTripsByEmployee(data.employeeId);
      const isOverlapping = existingTrips.some(trip => {
        // Skip current trip if it's an update (though this is POST)
        const start = data.startDate;
        const end = data.endDate;
        const tripStart = trip.startDate;
        const tripEnd = trip.endDate;

        // Overlap condition: (StartA <= EndB) and (EndA >= StartB)
        return trip.id !== data.sourceTripId && (start <= tripEnd) && (end >= tripStart);
      });

      if (isOverlapping) {
        return res.status(400).json({ error: "даты командировки пересекаются датой с другой командировкой" });
      }

      const trip = await storage.createTrip(data);
      if (data.memoType === "reschedule" && data.sourceTripId) {
        await storage.updateTrip(data.sourceTripId, { status: "rescheduling" });
      }
      
      // If status is pending, create approval request
      if (trip.status === "pending") {
        const employee = await storage.getUser(trip.employeeId);
        if (employee) {
          // Check if current user is the same as the employee
          const isOwnTrip = currentUser?.id === data.employeeId;
          
          if (isOwnTrip && currentUser!.role && ["ceo", "admin"].includes(currentUser!.role)) {
            // If CEO/Admin creates their OWN trip, approve it immediately
            await storage.updateTrip(trip.id, { status: "approved" });
          } else if (employee.role === "deputy_ceo" && !isOwnTrip) {
            // If someone creates a trip for Deputy CEO (not by deputy_ceo themselves)
            // Deputy CEO trips go straight to director_approved (awaiting admin/final approval)
            await storage.updateTrip(trip.id, { status: "director_approved" });
            
            // For Deputy CEO, we find an admin to approve
            const admins = (await storage.getAllUsers()).filter(u => u.role === "admin");
            if (admins.length > 0) {
              await storage.createApproval({
                tripId: trip.id,
                approverId: admins[0].id,
                status: "pending",
              });
            }
          } else if (employee.managerId) {
            // Regular employee trips go to their manager
            await storage.createApproval({
              tripId: trip.id,
              approverId: employee.managerId,
              status: "pending",
            });
          }
        }
      }
      
      const tripWithDetails = await storage.getTripWithDetails(trip.id);
      res.status(201).json(tripWithDetails);
    } catch (error: any) {
      res.status(400).json({ error: error.message || "Failed to create trip" });
    }
  });

  // Update trip
  app.patch("/api/trips/:id", async (req, res) => {
    try {
      const currentUser = req.session.userId ? await storage.getUser(req.session.userId) : null;
      if (!currentUser) return res.status(401).json({ error: "Not authenticated" });
      const existingTrip = await storage.getTrip(req.params.id);
      if (!existingTrip) return res.status(404).json({ error: "Trip not found" });
      if (existingTrip.employeeId !== currentUser.id) {
        return res.status(403).json({ error: "Можно редактировать только собственный черновик" });
      }
      if (existingTrip.status !== "draft") {
        return res.status(400).json({ error: "Редактировать можно только командировку в статусе «Черновик»" });
      }
      const data = insertTripSchema.partial().parse(req.body);
      if (!isValidTrivioBookingUrl(data.trivioBookingUrl)) {
        return res.status(400).json({ error: "Trivio booking link must be an HTTPS link on trivio.ru" });
      }
      if (data.employeeId && data.employeeId !== existingTrip.employeeId) {
        return res.status(403).json({ error: "Нельзя изменить сотрудника в черновике" });
      }
      if (data.status && !["draft", "pending"].includes(data.status)) {
        return res.status(400).json({ error: "Черновик можно сохранить или отправить на согласование" });
      }

      const nextStartDate = data.startDate || existingTrip.startDate;
      const nextEndDate = data.endDate || existingTrip.endDate;
      const existingTrips = await storage.getTripsByEmployee(existingTrip.employeeId);
      const overlaps = existingTrips.some((trip) =>
        trip.id !== existingTrip.id && nextStartDate <= trip.endDate && nextEndDate >= trip.startDate
      );
      if (overlaps) {
        return res.status(400).json({ error: "Даты командировки пересекаются с другой командировкой" });
      }

      const { employeeId: _employeeId, ...changes } = data;
      const trip = await storage.updateTrip(req.params.id, changes);
      if (!trip) return res.status(404).json({ error: "Trip not found" });

      if (trip.status === "pending") {
        const employee = await storage.getUser(trip.employeeId);
        if (employee?.managerId) {
          await storage.createApproval({ tripId: trip.id, approverId: employee.managerId, status: "pending" });
        }
      }
      
      const tripWithDetails = await storage.getTripWithDetails(trip.id);
      res.json(tripWithDetails);
    } catch (error: any) {
      res.status(400).json({ error: error.message || "Failed to update trip" });
    }
  });

  // Delete trip
  app.delete("/api/trips/:id", async (req, res) => {
    try {
      const success = await storage.deleteTrip(req.params.id);
      if (!success) {
        return res.status(404).json({ error: "Trip not found" });
      }
      res.status(204).send();
    } catch (error) {
      res.status(500).json({ error: "Failed to delete trip" });
    }
  });

  // Get trips for approval by manager
  app.get("/api/approvals/pending/:managerId", async (req, res) => {
    try {
      const currentUser = req.session.userId ? await storage.getUser(req.session.userId) : null;
      if (!currentUser) return res.status(401).json({ error: "Not authenticated" });
      if (currentUser.id !== req.params.managerId && !elevatedTripViewerRoles.has(currentUser.role || "")) {
        return res.status(403).json({ error: "You do not have access to these approvals" });
      }
      if (currentUser.userType !== "manager" && !elevatedTripViewerRoles.has(currentUser.role || "")) {
        return res.status(403).json({ error: "Only managers can view approvals" });
      }
      const trips = await storage.getTripsForApproval(req.params.managerId);
      res.json(trips);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch trips for approval" });
    }
  });

  // ============ APPROVALS ============
  
  // Approve or reject trip
  app.post("/api/approvals/:tripId", async (req, res) => {
    try {
      const { tripId } = req.params;
      const { approverId: bodyApproverId, status, comment } = req.body;
      
      if (!["approved", "rejected"].includes(status)) {
        return res.status(400).json({ error: "Invalid status. Must be 'approved' or 'rejected'" });
      }
      
      // Use current user as approver if approverId not provided
      const approverId = bodyApproverId || req.session.userId;
      
      const trip = await storage.getTrip(tripId);
      if (!trip) {
        return res.status(404).json({ error: "Trip not found" });
      }

      const approver = await storage.getUser(approverId);
      if (!approver) {
        return res.status(404).json({ error: "Approver not found" });
      }

      const employee = await storage.getUser(trip.employeeId);
      if (!employee) {
        return res.status(404).json({ error: "Employee not found" });
      }

      // Department-based access control: only managers of same department can approve (except admin/ceo)
      const isAdmin = approver.role === "admin";
      const isCeo = approver.role === "ceo";
      const isDeputyCeo = approver.role === "deputy_ceo";
      const isManager = approver.userType === "manager";
      const isTerritorialManager = approver.role === "territorial_manager";

      if (!isAdmin && !isCeo && !isDeputyCeo) {
        if (!isManager || employee.department !== approver.department) {
          return res.status(403).json({ error: "Only department managers can approve trips" });
        }
        // ТМ может согласовывать только прямых подчинённых (не всего отдела)
        if (isTerritorialManager && employee.managerId !== approver.id) {
          return res.status(403).json({ error: "Territorial manager can only approve their direct subordinates" });
        }
      }

      let newTripStatus: TripStatus = trip.status;

      if (status === "rejected") {
        newTripStatus = "rejected";
      } else if (status === "approved") {
        if (approver.role && ["ceo", "deputy_ceo", "admin"].includes(approver.role)) {
          newTripStatus = "approved";
        } else if (approver.role && ["marketing_director", "sales_director", "commerce_director"].includes(approver.role)) {
          newTripStatus = "director_approved";
        } else if (approver.role && ["territorial_manager", "commercial_manager", "product_manager", "kam"].includes(approver.role)) {
          newTripStatus = "manager_approved";
        } else {
          // Если роль не специфическая, но он является руководителем
          newTripStatus = "manager_approved";
        }
      }

      // Update trip status
      await storage.updateTrip(tripId, { status: newTripStatus });
      
      // Create or update approval record
      const existingApprovals = await storage.getApprovalsByTrip(tripId);
      const existingApproval = existingApprovals.find(a => a.approverId === approverId);
      
      if (existingApproval) {
        await storage.updateApproval(existingApproval.id, { status: status as any, comment });
      } else {
        await storage.createApproval({
          tripId,
          approverId,
          status: status as any,
          comment,
        });
      }
      
      const tripWithDetails = await storage.getTripWithDetails(tripId);
      res.json(tripWithDetails);
    } catch (error: any) {
      res.status(400).json({ error: error.message || "Failed to process approval" });
    }
  });

  // Get dashboard stats
  app.get("/api/stats/dashboard/:userId", async (req, res) => {
    try {
      const user = req.session.userId ? await storage.getUser(req.session.userId) : null;
      if (!user) return res.status(401).json({ error: "Not authenticated" });
      const filteredTrips = await getVisibleTripsForUser(user);
      const now = new Date();
      now.setHours(0, 0, 0, 0);
      const nowStr = now.toISOString().split('T')[0];

      // Manager specific: trips from subordinates that need approval
      const tripsForApproval = user.userType === "manager" || elevatedTripViewerRoles.has(user.role || "")
        ? await storage.getTripsForApproval(user.id)
        : [];
      const pendingStatuses = ["pending", "manager_approved", "director_approved"];

      res.json({
        totalTrips: filteredTrips.length,
        pendingTrips: filteredTrips.filter(t => pendingStatuses.includes(t.status)).length,
        approvedTrips: filteredTrips.filter(t => t.status === "approved").length,
        activeTrips: filteredTrips.filter(t => 
          t.status === "approved" && t.startDate <= nowStr && t.endDate >= nowStr
        ).length,
        rejectedTrips: filteredTrips.filter(t => t.status === "rejected").length,
        pendingApprovals: tripsForApproval.filter(t => pendingStatuses.includes(t.status)).length,
      });
    } catch (error) {
      console.error("[STATS] Dashboard stats error:", error);
      res.status(500).json({ error: "Failed to fetch stats" });
    }
  });

  // ============ ROUTES ============
  
  // Get all routes
  app.get("/api/routes", async (req, res) => {
    try {
      const routes = await storage.getAllRoutes();
      res.json(routes);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch routes" });
    }
  });

  // Create route (admin only)
  app.post("/api/routes", requireCoordinatorOrAdmin, async (req, res) => {
    try {
      console.log("[ROUTES] Create route request, userId:", req.session.userId);
      console.log("[ROUTES] Create route request body:", JSON.stringify(req.body));
      const { path, distance, cities, kilometers } = req.body;
      
      if (!path || !distance || !cities) {
        return res.status(400).json({ error: "Missing required route fields" });
      }

      // Ensure cities is an array
      const citiesArray = Array.isArray(cities) 
        ? cities 
        : typeof cities === 'string' 
          ? cities.split(',').map(c => c.trim())
          : [];

      const route = await storage.createRoute({
        path,
        distance: String(distance),
        cities: citiesArray,
        kilometers: String(kilometers || distance.replace(/[^0-9]/g, '')),
      });
      
      console.log("[ROUTES] Route created successfully:", route.id);
      res.status(201).json(route);
    } catch (error: any) {
      console.error("[ROUTES] Error creating route:", error);
      res.status(400).json({ error: error.message || "Failed to create route" });
    }
  });

  // Delete route
  app.delete("/api/routes/:id", requireCoordinatorOrAdmin, async (req, res) => {
    try {
      const success = await storage.deleteRoute(req.params.id);
      if (!success) {
        return res.status(404).json({ error: "Route not found" });
      }
      res.status(204).send();
    } catch (error) {
      res.status(500).json({ error: "Failed to delete route" });
    }
  });

  // Reset all trips (admin only)
  app.post("/api/admin/reset-trips", requireAdmin, async (req, res) => {
    try {
      await storage.deleteAllTrips();
      res.json({ success: true, message: "All trips have been cleared" });
    } catch (error) {
      res.status(500).json({ error: "Failed to reset trips" });
    }
  });

  app.post("/api/admin/reset-all-trip-data", requireAdmin, async (_req, res) => {
    try {
      await storage.clearAllTripAndCommunicationData();
      res.json({ success: true, message: "All trip, approval, chat, and contact data has been cleared" });
    } catch (error) {
      res.status(500).json({ error: "Failed to reset trip and communication data" });
    }
  });

  // ============ REPORTS ============
  
  const getReportDateRange = (query: any) => {
    const now = new Date();
    const fallbackStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
    const fallbackEnd = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()).padStart(2, "0")}`;
    const startDate = typeof query.startDate === "string" ? query.startDate : fallbackStart;
    const endDate = typeof query.endDate === "string" ? query.endDate : fallbackEnd;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate) || startDate > endDate) {
      return null;
    }
    return { startDate, endDate };
  };

  const formatReportDate = (date: string) => date.split("-").reverse().join(".");

  // Helper function to get report data
  const getReportData = async (periodStart: string, periodEnd: string) => {
    // Get all approved trips
    const allTrips = await storage.getTripsByStatus("approved");
    
    // Get daily allowance
    const allowance = await storage.getDailyAllowance();
    const amountPerNight = parseInt(allowance?.amountPerNight || "1700");
    
    // A trip belongs to the registry when it overlaps the requested period.
    const tripsInPeriod = await Promise.all(
      allTrips
        .filter(trip => {
          return trip.startDate <= periodEnd && trip.endDate >= periodStart;
        })
        .map(async (trip) => {
          const details = await storage.getTripWithDetails(trip.id);
          if (!details) return null;
          
          const startDate = new Date(trip.startDate);
          const endDate = new Date(trip.endDate);
          const nights = Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
          const totalAllowance = nights > 0 ? nights * amountPerNight : 0;
          
          return {
            ...details,
            nights,
            totalAllowance,
          };
        })
    );
    
    const validTrips = tripsInPeriod.filter(t => t !== null);
    
    // Split into two groups
    const withAllowance = validTrips.filter(t => t!.totalAllowance > 0);
    const withoutAllowance = validTrips.filter(t => t!.totalAllowance === 0);

    const totalWithAllowance = withAllowance.reduce((sum, t) => sum + (t!.totalAllowance || 0), 0);
    const totalWithoutAllowance = withoutAllowance.reduce((sum, t) => sum + (t!.totalAllowance || 0), 0);
    const grandTotal = totalWithAllowance + totalWithoutAllowance;

    return {
      periodStart,
      periodEnd,
      amountPerNight,
      withAllowance: withAllowance.map((t, idx) => ({ ...t, number: idx + 1 })),
      withoutAllowance: withoutAllowance.map((t, idx) => ({ ...t, number: withAllowance.length + idx + 1 })),
      totalWithAllowance,
      totalWithoutAllowance,
      grandTotal,
    };
  };

  // Get trips report for a selected period (with daily allowance calculation)
  app.get("/api/admin/trips-report", requireCoordinatorOrAdmin, async (req, res) => {
    try {
      const period = getReportDateRange(req.query);
      if (!period) return res.status(400).json({ error: "Укажите корректные даты периода" });
      const data = await getReportData(period.startDate, period.endDate);
      res.json(data);
    } catch (error) {
      console.error("Report error:", error);
      res.status(500).json({ error: "Failed to generate report" });
    }
  });

  // Export trips report to Excel
  app.get("/api/admin/trips-report/export", requireCoordinatorOrAdmin, async (req, res) => {
    try {
      const period = getReportDateRange(req.query);
      if (!period) return res.status(400).json({ error: "Укажите корректные даты периода" });
      
      console.log(`[EXPORT] Request received - session.userId: ${req.session.userId}, sessionID: ${req.sessionID}`);
      console.log(`[EXPORT] Exporting report for ${period.startDate} to ${period.endDate}`);
      const data = await getReportData(period.startDate, period.endDate);
      console.log(`[EXPORT] Report data ready: ${data.withAllowance.length} with allowance, ${data.withoutAllowance.length} without`);
      
      // Dynamically import ExcelJS
      const ExcelJS = (await import("exceljs")).default;
      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet("Реестр командировок");
      
      // Title
      const titleRow = worksheet.addRow([
        `Реестр командировок за период с ${formatReportDate(period.startDate)} по ${formatReportDate(period.endDate)}`,
      ]);
      titleRow.font = { bold: true, size: 14 };
      worksheet.mergeCells("A1:H1");
      
      // Empty row
      worksheet.addRow([]);
      
      // Header
      const headers = [
        "№ п/п",
        "ФИО",
        "Отдел",
        "Срок командировки",
        "Город проживания - Город командировки - Город проживания",
        "Транспорт",
        "Ночей",
        "Итог суточные, руб.",
      ];
      
      const headerRow = worksheet.addRow(headers);
      headerRow.font = { bold: true };
      headerRow.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE0E0E0" } };
      
      // Add "with allowance" trips
      if (data.withAllowance && data.withAllowance.length > 0) {
        worksheet.addRow([]);
        worksheet.addRow(["Командировки с суточными"]);
        
        data.withAllowance.forEach((trip) => {
          const startDate = new Date(trip.startDate);
          const endDate = new Date(trip.endDate);
          const tripDates = `${startDate.getDate().toString().padStart(2, "0")}.${(startDate.getMonth() + 1).toString().padStart(2, "0")}.${startDate.getFullYear()} - ${endDate.getDate().toString().padStart(2, "0")}.${(endDate.getMonth() + 1).toString().padStart(2, "0")}.${endDate.getFullYear()}`;
          const routePath = trip.route?.path || "-";
          const transportMap: Record<string, string> = { plane: "Самолет", train: "Поезд", car: "Автомобиль" };

          worksheet.addRow([
            trip.number,
            trip.employee?.fullName || "-",
            trip.employee?.department || "-",
            tripDates,
            routePath,
            transportMap[trip.transportType] || trip.transportType,
            trip.nights,
            trip.totalAllowance,
          ]);
        });

        // Subtotal for with allowance
        const subtotalWithRow = worksheet.addRow(["", "", "", "", "", "", "Итого по суточным:", data.totalWithAllowance]);
        subtotalWithRow.font = { bold: true };
        subtotalWithRow.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF5F5F5" } };
      }

      // Empty row
      worksheet.addRow([]);

      // Add "without allowance" trips
      if (data.withoutAllowance && data.withoutAllowance.length > 0) {
        const sectionRow = worksheet.addRow(["Командировки без суточных"]);
        sectionRow.font = { bold: true };

        data.withoutAllowance.forEach((trip) => {
          const startDate = new Date(trip.startDate);
          const endDate = new Date(trip.endDate);
          const tripDates = `${startDate.getDate().toString().padStart(2, "0")}.${(startDate.getMonth() + 1).toString().padStart(2, "0")}.${startDate.getFullYear()} - ${endDate.getDate().toString().padStart(2, "0")}.${(endDate.getMonth() + 1).toString().padStart(2, "0")}.${endDate.getFullYear()}`;
          const routePath = trip.route?.path || "-";
          const transportMap: Record<string, string> = { plane: "Самолет", train: "Поезд", car: "Автомобиль" };

          worksheet.addRow([
            trip.number,
            trip.employee?.fullName || "-",
            trip.employee?.department || "-",
            tripDates,
            routePath,
            transportMap[trip.transportType] || trip.transportType,
            trip.nights,
            trip.totalAllowance || 0,
          ]);
        });

        // Subtotal for without allowance
        const subtotalWithoutRow = worksheet.addRow(["", "", "", "", "", "", "Итого по без суточных:", data.totalWithoutAllowance]);
        subtotalWithoutRow.font = { bold: true };
        subtotalWithoutRow.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF5F5F5" } };
      }

      // Empty row before grand total
      worksheet.addRow([]);

      // Grand total
      if ((data.withAllowance && data.withAllowance.length > 0) || (data.withoutAllowance && data.withoutAllowance.length > 0)) {
        const grandTotalRow = worksheet.addRow(["", "", "", "", "", "", "ОБЩИЙ ИТОГ:", data.grandTotal]);
        grandTotalRow.font = { bold: true, size: 12 };
        grandTotalRow.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE0E0E0" } };
      }

      // Adjust column widths
      worksheet.columns = [
        { width: 8 },
        { width: 25 },
        { width: 15 },
        { width: 25 },
        { width: 45 },
        { width: 12 },
        { width: 8 },
        { width: 15 },
      ];
      
      // Generate buffer
      const buffer = await workbook.xlsx.writeBuffer() as Buffer;
      console.log(`[EXPORT] Buffer generated, size: ${buffer.length} bytes`);
      
      // Send file
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      const encodedFileName = encodeURIComponent(`Реестр_командировок_${period.startDate}_по_${period.endDate}.xlsx`);
      res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodedFileName}`);
      console.log(`[EXPORT] Sending file: ${encodedFileName}`);
      res.send(buffer);
    } catch (error) {
      console.error("Export error:", error);
      res.status(500).json({ error: "Failed to export report" });
    }
  });

  // ============ DAILY ALLOWANCE ============
  
  app.get("/api/daily-allowance", async (_req, res) => {
    try {
      const allowance = await storage.getDailyAllowance();
      if (!allowance) {
        // Return default if not set
        return res.json({ amountPerNight: "1700" });
      }
      res.json(allowance);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch daily allowance" });
    }
  });

  app.post("/api/daily-allowance", requireAdmin, async (req, res) => {
    try {
      const parsed = insertDailyAllowanceSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid daily allowance data" });
      }
      const allowance = await storage.updateDailyAllowance(parsed.data.amountPerNight);
      res.json(allowance);
    } catch (error) {
      res.status(500).json({ error: "Failed to update daily allowance" });
    }
  });

  // ============ HOLIDAYS ============

  app.get("/api/holidays", async (_req, res) => {
    try {
      const holidays = await storage.getAllHolidays();
      res.json(holidays);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch holidays" });
    }
  });

  app.post("/api/holidays", requireCoordinatorOrAdmin, async (req, res) => {
    try {
      const parsed = insertHolidaySchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid holiday data" });
      }
      const holiday = await storage.createHoliday(parsed.data);
      res.status(201).json(holiday);
    } catch (error) {
      res.status(500).json({ error: "Failed to create holiday" });
    }
  });

  app.patch("/api/holidays/:id", requireCoordinatorOrAdmin, async (req, res) => {
    try {
      const parsed = insertHolidaySchema.partial().safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid holiday data" });
      }
      const holiday = await storage.updateHoliday(req.params.id, parsed.data);
      if (!holiday) {
        return res.status(404).json({ error: "Holiday not found" });
      }
      res.json(holiday);
    } catch (error) {
      res.status(500).json({ error: "Failed to update holiday" });
    }
  });

  app.delete("/api/holidays/:id", requireCoordinatorOrAdmin, async (req, res) => {
    try {
      const success = await storage.deleteHoliday(req.params.id);
      if (!success) {
        return res.status(404).json({ error: "Holiday not found" });
      }
      res.status(204).send();
    } catch (error) {
      res.status(500).json({ error: "Failed to delete holiday" });
    }
  });

  // ============ USER ACCOUNT ENDPOINTS ============

  // Change password
  app.patch("/api/auth/change-password", async (req, res) => {
    try {
      if (!req.session.userId) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      const { currentPassword, newPassword } = req.body;
      if (!currentPassword || !newPassword) {
        return res.status(400).json({ error: "Current and new password required" });
      }

      const user = await storage.getUser(req.session.userId);
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }

      // Verify current password
      const validated = await storage.validatePassword(user.email, currentPassword);
      if (!validated) {
        return res.status(401).json({ error: "Current password is incorrect" });
      }

      // Validate new password
      const validation = validatePassword(newPassword);
      if (!validation.valid) {
        return res.status(400).json({ error: validation.errors.join(", ") });
      }

      // Update password
      await storage.updateUser(user.id, { password: newPassword } as any);
      res.json({ success: true, message: "Password changed successfully" });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to change password" });
    }
  });

  // Switch user (admin only for testing)
  app.post("/api/auth/switch-user", async (req, res) => {
    try {
      console.log(`[AUTH] Switch user request: sessionId=${req.sessionID}, userId=${req.session?.userId}`);
      
      const { userId } = req.body;
      if (!userId) {
        return res.status(400).json({ error: "User ID required" });
      }

      // Check if current user is admin
      if (!req.session?.userId) {
        console.log("[AUTH] Switch user BLOCKED: No session userId");
        return res.status(401).json({ error: "Not authenticated" });
      }

      const adminUser = await storage.getUser(req.session.userId);
      console.log(`[AUTH] Admin check: adminUser=${adminUser?.email}, role=${adminUser?.role}`);
      
      if (!adminUser || !["admin", "coordinator"].includes(adminUser.role || "")) {
        return res.status(403).json({ error: "Only administrators or coordinators can switch users" });
      }

      // Get the target user
      const targetUser = await storage.getUser(userId);
      if (!targetUser) {
        return res.status(404).json({ error: "User not found" });
      }
      if (adminUser.role === "coordinator" && targetUser.userType === "manager") {
        return res.status(403).json({ error: "Coordinator can switch only to employee test accounts" });
      }

      // Switch session to target user
      req.session.userId = userId;
      const { password: _, ...userWithoutPassword } = targetUser;
      console.log(`[AUTH] Admin switched to user: ${targetUser.email}`);
      
      // CRITICAL: Save session to ensure Set-Cookie header is sent
      req.session.save((err) => {
        if (err) {
          console.error("[AUTH] Switch user session save error:", err);
          return res.status(500).json({ error: "Session save failed" });
        }
        console.log(`[AUTH] Session saved successfully for userId=${userId}`);
        res.json(userWithoutPassword);
      });
    } catch (error) {
      console.error("[AUTH] Switch user error:", error);
      res.status(500).json({ error: "Switch user failed" });
    }
  });

  // ============ USERS ============
  
  // Get all users (role-aware: each role sees only their scope)
  app.get("/api/users", async (req, res) => {
    try {
      const { department } = req.query;
      const currentUser = req.session.userId ? await storage.getUser(req.session.userId) : null;
      let users: User[];

      // Helper: dedupe by id
      const deduped = (arr: User[]) =>
        Array.from(new Map(arr.map(u => [u.id, u])).values());

      if (!currentUser) {
        // Unauthenticated — return empty
        return res.json([]);
      }

      const role = currentUser.role;
      const utype = currentUser.userType;

      if (role === "admin" || role === "ceo" || role === "coordinator") {
        // Full visibility
        users = await storage.getAllUsers();

      } else if (role === "territorial_manager") {
        // ТМ: себя + прямые подчинённые (МП) + менеджер (для отображения имени)
        const subordinates = await storage.getUsersByManager(currentUser.id);
        const base = subordinates.some(u => u.id === currentUser.id)
          ? subordinates
          : [currentUser, ...subordinates];
        if (currentUser.managerId && !base.some(u => u.id === currentUser.managerId)) {
          const mgr = await storage.getUser(currentUser.managerId);
          users = mgr ? [...base, mgr] : base;
        } else {
          users = base;
        }

      } else if (utype === "manager") {
        // Руководитель отдела (директор, зам. директора и т.п.):
        // Себя + прямые подчинённые + подчинённые подчинённых (2 уровня → охватывает ТМ → МП)
        const directSubs = await storage.getUsersByManager(currentUser.id);
        const level2: typeof directSubs = [];
        for (const sub of directSubs) {
          const subSubs = await storage.getUsersByManager(sub.id);
          level2.push(...subSubs);
        }
        users = deduped([currentUser, ...directSubs, ...level2]);

      } else if (utype === "employee" && currentUser.managerId) {
        // Рядовой сотрудник (МП и т.п.):
        // Себя + менеджер + коллеги (сотрудники с тем же manager_id)
        const siblings = await storage.getUsersByManager(currentUser.managerId);
        const mgr = await storage.getUser(currentUser.managerId);
        const base = mgr ? [mgr, ...siblings] : [...siblings];
        users = deduped(base.some(u => u.id === currentUser.id) ? base : [...base, currentUser]);

      } else if (department) {
        users = await storage.getUsersByDepartment(department as string);

      } else {
        users = await storage.getAllUsers();
      }

      res.json(users.sort((first, second) => first.fullName.localeCompare(second.fullName, "ru")));
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch users" });
    }
  });

  // Get user by ID
  app.get("/api/users/:id", async (req, res) => {
    try {
      const user = await storage.getUser(req.params.id);
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }
      res.json(user);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch user" });
    }
  });

  // Clear non-admin users before loading new file (admin only)
  app.post("/api/users/clear-old", requireAdmin, async (req, res) => {
    try {
      await storage.clearNonAdminUsers();
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to clear users" });
    }
  });

  // Create or update user (UPSERT on email) - admin only
  app.post("/api/users", requireCoordinatorOrAdmin, async (req, res) => {
    try {
      console.log("[USERS] Create/Update user request:", JSON.stringify(req.body));
      const data = insertUserSchema.parse(req.body);
      const { user, password } = await storage.upsertUser(data);
      console.log("[USERS] User created successfully:", user.id);
      res.status(201).json({ user, password });
    } catch (error: any) {
      console.error("[USERS] Error creating user:", error);
      res.status(400).json({ error: error.message || "Failed to create user" });
    }
  });

  // Update user (admin only)
  app.patch("/api/users/:id", requireCoordinatorOrAdmin, async (req, res) => {
    try {
      const data = insertUserSchema.partial().parse(req.body);
      const user = await storage.updateUser(req.params.id, data);
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }
      res.json(user);
    } catch (error: any) {
      res.status(400).json({ error: error.message || "Failed to update user" });
    }
  });

  // Delete user (admin only)
  app.delete("/api/users/:id", requireCoordinatorOrAdmin, async (req, res) => {
    try {
      const success = await storage.deleteUser(req.params.id);
      if (!success) {
        return res.status(404).json({ error: "User not found" });
      }
      res.status(204).send();
    } catch (error) {
      res.status(500).json({ error: "Failed to delete user" });
    }
  });

  // ============ CITIES ============
  
  // Get all cities
  app.get("/api/cities", async (req, res) => {
    try {
      const cities = await storage.getAllCities();
      cities.sort((a, b) => a.name.localeCompare(b.name, "ru"));
      res.json(cities);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch cities" });
    }
  });

  // Get city by ID
  app.get("/api/cities/:id", async (req, res) => {
    try {
      const city = await storage.getCity(req.params.id);
      if (!city) {
        return res.status(404).json({ error: "City not found" });
      }
      res.json(city);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch city" });
    }
  });

  // Create city
  app.post("/api/cities", async (req, res) => {
    try {
      const data = insertCitySchema.parse(req.body);
      
      // Check for duplicate
      const existing = await storage.getCityByName(data.name);
      if (existing) {
        return res.status(409).json({ error: "City with this name already exists" });
      }
      
      const city = await storage.createCity(data);
      res.status(201).json(city);
    } catch (error: any) {
      res.status(400).json({ error: error.message || "Failed to create city" });
    }
  });

  // Update city
  app.patch("/api/cities/:id", async (req, res) => {
    try {
      const data = insertCitySchema.partial().parse(req.body);
      const city = await storage.updateCity(req.params.id, data);
      if (!city) {
        return res.status(404).json({ error: "City not found" });
      }
      res.json(city);
    } catch (error: any) {
      res.status(400).json({ error: error.message || "Failed to update city" });
    }
  });

  // Delete city
  app.delete("/api/cities/:id", async (req, res) => {
    try {
      const success = await storage.deleteCity(req.params.id);
      if (!success) {
        return res.status(404).json({ error: "City not found" });
      }
      res.status(204).send();
    } catch (error) {
      res.status(500).json({ error: "Failed to delete city" });
    }
  });

  // ============ TRIPS ============
  
  // Get all trips (with optional filters)
  app.get("/api/trips", async (req, res) => {
    try {
      const currentUser = req.session.userId ? await storage.getUser(req.session.userId) : null;
      if (!currentUser) return res.status(401).json({ error: "Not authenticated" });
      const trips = await applyTripFilters(await getVisibleTripsForUser(currentUser), req.query);
      
      // Enrich with details
      const tripsWithDetails = await Promise.all(
        trips.map(trip => storage.getTripWithDetails(trip.id))
      );
      
      res.json(tripsWithDetails.filter(t => t !== undefined));
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch trips" });
    }
  });

  // Get trip by ID
  app.get("/api/trips/:id", async (req, res) => {
    try {
      const trip = await storage.getTripWithDetails(req.params.id);
      if (!trip) {
        return res.status(404).json({ error: "Trip not found" });
      }
      res.json(trip);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch trip" });
    }
  });

  // Create trip
  app.post("/api/trips", async (req, res) => {
    try {
      const data = insertTripSchema.parse(req.body);
      if (!isValidTrivioBookingUrl(data.trivioBookingUrl)) {
        return res.status(400).json({ error: "Trivio booking link must be an HTTPS link on trivio.ru" });
      }
      const currentUser = req.session.userId ? await storage.getUser(req.session.userId) : null;
      if (data.memoType === "reschedule") {
        const sourceTrip = data.sourceTripId ? await storage.getTrip(data.sourceTripId) : undefined;
        if (data.tripType !== "unplanned" || !sourceTrip || sourceTrip.employeeId !== data.employeeId) {
          return res.status(400).json({ error: "Для переноса выберите свою ранее созданную командировку" });
        }
      }

      // Check for overlapping trips
      const existingTrips = await storage.getTripsByEmployee(data.employeeId);
      const isOverlapping = existingTrips.some(trip => {
        // Skip current trip if it's an update (though this is POST)
        const start = data.startDate;
        const end = data.endDate;
        const tripStart = trip.startDate;
        const tripEnd = trip.endDate;

        // Overlap condition: (StartA <= EndB) and (EndA >= StartB)
        return trip.id !== data.sourceTripId && (start <= tripEnd) && (end >= tripStart);
      });

      if (isOverlapping) {
        return res.status(400).json({ error: "даты командировки пересекаются датой с другой командировкой" });
      }

      const trip = await storage.createTrip(data);
      if (data.memoType === "reschedule" && data.sourceTripId) {
        await storage.updateTrip(data.sourceTripId, { status: "rescheduling" });
      }
      
      // If status is pending, create approval request
      if (trip.status === "pending") {
        const employee = await storage.getUser(trip.employeeId);
        if (employee) {
          // Check if current user is the same as the employee
          const isOwnTrip = currentUser?.id === data.employeeId;
          
          if (isOwnTrip && currentUser!.role && ["ceo", "admin"].includes(currentUser!.role)) {
            // If CEO/Admin creates their OWN trip, approve it immediately
            await storage.updateTrip(trip.id, { status: "approved" });
          } else if (employee.role === "deputy_ceo" && !isOwnTrip) {
            // If someone creates a trip for Deputy CEO (not by deputy_ceo themselves)
            // Deputy CEO trips go straight to director_approved (awaiting admin/final approval)
            await storage.updateTrip(trip.id, { status: "director_approved" });
            
            // For Deputy CEO, we find an admin to approve
            const admins = (await storage.getAllUsers()).filter(u => u.role === "admin");
            if (admins.length > 0) {
              await storage.createApproval({
                tripId: trip.id,
                approverId: admins[0].id,
                status: "pending",
              });
            }
          } else if (employee.managerId) {
            // Regular employee trips go to their manager
            await storage.createApproval({
              tripId: trip.id,
              approverId: employee.managerId,
              status: "pending",
            });
          }
        }
      }
      
      const tripWithDetails = await storage.getTripWithDetails(trip.id);
      res.status(201).json(tripWithDetails);
    } catch (error: any) {
      res.status(400).json({ error: error.message || "Failed to create trip" });
    }
  });

  // Update trip
  app.patch("/api/trips/:id", async (req, res) => {
    try {
      const currentUser = req.session.userId ? await storage.getUser(req.session.userId) : null;
      if (!currentUser) return res.status(401).json({ error: "Not authenticated" });
      const existingTrip = await storage.getTrip(req.params.id);
      if (!existingTrip) return res.status(404).json({ error: "Trip not found" });
      if (existingTrip.employeeId !== currentUser.id) {
        return res.status(403).json({ error: "Можно редактировать только собственный черновик" });
      }
      if (existingTrip.status !== "draft") {
        return res.status(400).json({ error: "Редактировать можно только командировку в статусе «Черновик»" });
      }
      const data = insertTripSchema.partial().parse(req.body);
      if (!isValidTrivioBookingUrl(data.trivioBookingUrl)) {
        return res.status(400).json({ error: "Trivio booking link must be an HTTPS link on trivio.ru" });
      }
      if (data.employeeId && data.employeeId !== existingTrip.employeeId) {
        return res.status(403).json({ error: "Нельзя изменить сотрудника в черновике" });
      }
      if (data.status && !["draft", "pending"].includes(data.status)) {
        return res.status(400).json({ error: "Черновик можно сохранить или отправить на согласование" });
      }

      const nextStartDate = data.startDate || existingTrip.startDate;
      const nextEndDate = data.endDate || existingTrip.endDate;
      const existingTrips = await storage.getTripsByEmployee(existingTrip.employeeId);
      const overlaps = existingTrips.some((trip) =>
        trip.id !== existingTrip.id && nextStartDate <= trip.endDate && nextEndDate >= trip.startDate
      );
      if (overlaps) {
        return res.status(400).json({ error: "Даты командировки пересекаются с другой командировкой" });
      }

      const { employeeId: _employeeId, ...changes } = data;
      const trip = await storage.updateTrip(req.params.id, changes);
      if (!trip) return res.status(404).json({ error: "Trip not found" });

      if (trip.status === "pending") {
        const employee = await storage.getUser(trip.employeeId);
        if (employee?.managerId) {
          await storage.createApproval({ tripId: trip.id, approverId: employee.managerId, status: "pending" });
        }
      }
      
      const tripWithDetails = await storage.getTripWithDetails(trip.id);
      res.json(tripWithDetails);
    } catch (error: any) {
      res.status(400).json({ error: error.message || "Failed to update trip" });
    }
  });

  // Delete trip
  app.delete("/api/trips/:id", async (req, res) => {
    try {
      const success = await storage.deleteTrip(req.params.id);
      if (!success) {
        return res.status(404).json({ error: "Trip not found" });
      }
      res.status(204).send();
    } catch (error) {
      res.status(500).json({ error: "Failed to delete trip" });
    }
  });

  // Get trips for approval by manager
  app.get("/api/approvals/pending/:managerId", async (req, res) => {
    try {
      const currentUser = req.session.userId ? await storage.getUser(req.session.userId) : null;
      if (!currentUser) return res.status(401).json({ error: "Not authenticated" });
      if (currentUser.id !== req.params.managerId && !elevatedTripViewerRoles.has(currentUser.role || "")) {
        return res.status(403).json({ error: "You do not have access to these approvals" });
      }
      if (currentUser.userType !== "manager" && !elevatedTripViewerRoles.has(currentUser.role || "")) {
        return res.status(403).json({ error: "Only managers can view approvals" });
      }
      const trips = await storage.getTripsForApproval(req.params.managerId);
      res.json(trips);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch trips for approval" });
    }
  });

  // ============ APPROVALS ============
  
  // Approve or reject trip
  app.post("/api/approvals/:tripId", async (req, res) => {
    try {
      const { tripId } = req.params;
      const { approverId: bodyApproverId, status, comment } = req.body;
      
      if (!["approved", "rejected"].includes(status)) {
        return res.status(400).json({ error: "Invalid status. Must be 'approved' or 'rejected'" });
      }
      
      // Use current user as approver if approverId not provided
      const approverId = bodyApproverId || req.session.userId;
      
      const trip = await storage.getTrip(tripId);
      if (!trip) {
        return res.status(404).json({ error: "Trip not found" });
      }

      const approver = await storage.getUser(approverId);
      if (!approver) {
        return res.status(404).json({ error: "Approver not found" });
      }

      const employee = await storage.getUser(trip.employeeId);
      if (!employee) {
        return res.status(404).json({ error: "Employee not found" });
      }

      // Department-based access control: only managers of same department can approve (except admin/ceo)
      const isAdmin = approver.role === "admin";
      const isCeo = approver.role === "ceo";
      const isDeputyCeo = approver.role === "deputy_ceo";
      const isManager = approver.userType === "manager";
      const isTerritorialManager = approver.role === "territorial_manager";

      if (!isAdmin && !isCeo && !isDeputyCeo) {
        if (!isManager || employee.department !== approver.department) {
          return res.status(403).json({ error: "Only department managers can approve trips" });
        }
        // ТМ может согласовывать только прямых подчинённых (не всего отдела)
        if (isTerritorialManager && employee.managerId !== approver.id) {
          return res.status(403).json({ error: "Territorial manager can only approve their direct subordinates" });
        }
      }

      let newTripStatus: TripStatus = trip.status;

      if (status === "rejected") {
        newTripStatus = "rejected";
      } else if (status === "approved") {
        if (approver.role && ["ceo", "deputy_ceo", "admin"].includes(approver.role)) {
          newTripStatus = "approved";
        } else if (approver.role && ["marketing_director", "sales_director", "commerce_director"].includes(approver.role)) {
          newTripStatus = "director_approved";
        } else if (approver.role && ["territorial_manager", "commercial_manager", "product_manager", "kam"].includes(approver.role)) {
          newTripStatus = "manager_approved";
        } else {
          // Если роль не специфическая, но он является руководителем
          newTripStatus = "manager_approved";
        }
      }

      // Update trip status
      await storage.updateTrip(tripId, { status: newTripStatus });
      
      // Create or update approval record
      const existingApprovals = await storage.getApprovalsByTrip(tripId);
      const existingApproval = existingApprovals.find(a => a.approverId === approverId);
      
      if (existingApproval) {
        await storage.updateApproval(existingApproval.id, { status: status as any, comment });
      } else {
        await storage.createApproval({
          tripId,
          approverId,
          status: status as any,
          comment,
        });
      }
      
      const tripWithDetails = await storage.getTripWithDetails(tripId);
      res.json(tripWithDetails);
    } catch (error: any) {
      res.status(400).json({ error: error.message || "Failed to process approval" });
    }
  });

  // Get dashboard stats
  app.get("/api/stats/dashboard/:userId", async (req, res) => {
    try {
      const user = req.session.userId ? await storage.getUser(req.session.userId) : null;
      if (!user) return res.status(401).json({ error: "Not authenticated" });
      const filteredTrips = await getVisibleTripsForUser(user);
      
      const now = new Date();
      now.setHours(0, 0, 0, 0);
      const nowStr = now.toISOString().split('T')[0];

      // Manager specific: trips from subordinates that need approval
      const tripsForApproval = user.userType === "manager" || elevatedTripViewerRoles.has(user.role || "")
        ? await storage.getTripsForApproval(user.id)
        : [];
      const pendingStatuses = ["pending", "manager_approved", "director_approved"];

      res.json({
        totalTrips: filteredTrips.length,
        pendingTrips: filteredTrips.filter(t => pendingStatuses.includes(t.status)).length,
        approvedTrips: filteredTrips.filter(t => t.status === "approved").length,
        activeTrips: filteredTrips.filter(t => 
          t.status === "approved" && t.startDate <= nowStr && t.endDate >= nowStr
        ).length,
        rejectedTrips: filteredTrips.filter(t => t.status === "rejected").length,
        pendingApprovals: tripsForApproval.filter(t => pendingStatuses.includes(t.status)).length,
      });
    } catch (error) {
      console.error("[STATS] Dashboard stats error:", error);
      res.status(500).json({ error: "Failed to fetch stats" });
    }
  });

  // ============ ROUTES ============
  
  // Get all routes
  app.get("/api/routes", async (req, res) => {
    try {
      const routes = await storage.getAllRoutes();
      res.json(routes);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch routes" });
    }
  });

  // Create route (admin only)
  app.post("/api/routes", requireCoordinatorOrAdmin, async (req, res) => {
    try {
      console.log("[ROUTES] Create route request, userId:", req.session.userId);
      console.log("[ROUTES] Create route request body:", JSON.stringify(req.body));
      const { path, distance, cities, kilometers } = req.body;
      
      if (!path || !distance || !cities) {
        return res.status(400).json({ error: "Missing required route fields" });
      }

      // Ensure cities is an array
      const citiesArray = Array.isArray(cities) 
        ? cities 
        : typeof cities === 'string' 
          ? cities.split(',').map(c => c.trim())
          : [];

      const route = await storage.createRoute({
        path,
        distance: String(distance),
        cities: citiesArray,
        kilometers: String(kilometers || distance.replace(/[^0-9]/g, '')),
      });
      
      console.log("[ROUTES] Route created successfully:", route.id);
      res.status(201).json(route);
    } catch (error: any) {
      console.error("[ROUTES] Error creating route:", error);
      res.status(400).json({ error: error.message || "Failed to create route" });
    }
  });

  // Delete route
  app.delete("/api/routes/:id", requireCoordinatorOrAdmin, async (req, res) => {
    try {
      const success = await storage.deleteRoute(req.params.id);
      if (!success) {
        return res.status(404).json({ error: "Route not found" });
      }
      res.status(204).send();
    } catch (error) {
      res.status(500).json({ error: "Failed to delete route" });
    }
  });

  // Reset all trips (admin only)
  app.post("/api/admin/reset-trips", requireAdmin, async (req, res) => {
    try {
      await storage.deleteAllTrips();
      res.json({ success: true, message: "All trips and approvals have been cleared" });
    } catch (error) {
      res.status(500).json({ error: "Failed to reset trips" });
    }
  });

  // ============ REPORTS ============
  
  // Get trips report for a selected period (with daily allowance calculation)
  app.get("/api/admin/trips-report", requireCoordinatorOrAdmin, async (req, res) => {
    try {
      const period = getReportDateRange(req.query);
      if (!period) return res.status(400).json({ error: "Укажите корректные даты периода" });
      const data = await getReportData(period.startDate, period.endDate);
      res.json(data);
    } catch (error) {
      console.error("Report error:", error);
      res.status(500).json({ error: "Failed to generate report" });
    }
  });

  // Export trips report to Excel
  app.get("/api/admin/trips-report/export", requireCoordinatorOrAdmin, async (req, res) => {
    try {
      const period = getReportDateRange(req.query);
      if (!period) return res.status(400).json({ error: "Укажите корректные даты периода" });
      
      console.log(`[EXPORT] Request received - session.userId: ${req.session.userId}, sessionID: ${req.sessionID}`);
      console.log(`[EXPORT] Exporting report for ${period.startDate} to ${period.endDate}`);
      const data = await getReportData(period.startDate, period.endDate);
      console.log(`[EXPORT] Report data ready: ${data.withAllowance.length} with allowance, ${data.withoutAllowance.length} without`);
      
      // Dynamically import ExcelJS
      const ExcelJS = (await import("exceljs")).default;
      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet("Реестр командировок");
      
      // Title
      const titleRow = worksheet.addRow([
        `Реестр командировок за период с ${formatReportDate(period.startDate)} по ${formatReportDate(period.endDate)}`,
      ]);
      titleRow.font = { bold: true, size: 14 };
      worksheet.mergeCells("A1:H1");
      
      // Empty row
      worksheet.addRow([]);
      
      // Header
      const headers = [
        "№ п/п",
        "ФИО",
        "Отдел",
        "Срок командировки",
        "Город проживания - Город командировки - Город проживания",
        "Транспорт",
        "Ночей",
        "Итог суточные, руб.",
      ];
      
      const headerRow = worksheet.addRow(headers);
      headerRow.font = { bold: true };
      headerRow.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE0E0E0" } };
      
      // Add "with allowance" trips
      if (data.withAllowance && data.withAllowance.length > 0) {
        worksheet.addRow([]);
        worksheet.addRow(["Командировки с суточными"]);
        
        data.withAllowance.forEach((trip) => {
          const startDate = new Date(trip.startDate);
          const endDate = new Date(trip.endDate);
          const tripDates = `${startDate.getDate().toString().padStart(2, "0")}.${(startDate.getMonth() + 1).toString().padStart(2, "0")}.${startDate.getFullYear()} - ${endDate.getDate().toString().padStart(2, "0")}.${(endDate.getMonth() + 1).toString().padStart(2, "0")}.${endDate.getFullYear()}`;
          const routePath = trip.route?.path || "-";
          const transportMap: Record<string, string> = { plane: "Самолет", train: "Поезд", car: "Автомобиль" };

          worksheet.addRow([
            trip.number,
            trip.employee?.fullName || "-",
            trip.employee?.department || "-",
            tripDates,
            routePath,
            transportMap[trip.transportType] || trip.transportType,
            trip.nights,
            trip.totalAllowance,
          ]);
        });

        // Subtotal for with allowance
        const subtotalWithRow = worksheet.addRow(["", "", "", "", "", "", "Итого по суточным:", data.totalWithAllowance]);
        subtotalWithRow.font = { bold: true };
        subtotalWithRow.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF5F5F5" } };
      }

      // Empty row
      worksheet.addRow([]);

      // Add "without allowance" trips
      if (data.withoutAllowance && data.withoutAllowance.length > 0) {
        const sectionRow = worksheet.addRow(["Командировки без суточных"]);
        sectionRow.font = { bold: true };

        data.withoutAllowance.forEach((trip) => {
          const startDate = new Date(trip.startDate);
          const endDate = new Date(trip.endDate);
          const tripDates = `${startDate.getDate().toString().padStart(2, "0")}.${(startDate.getMonth() + 1).toString().padStart(2, "0")}.${startDate.getFullYear()} - ${endDate.getDate().toString().padStart(2, "0")}.${(endDate.getMonth() + 1).toString().padStart(2, "0")}.${endDate.getFullYear()}`;
          const routePath = trip.route?.path || "-";
          const transportMap: Record<string, string> = { plane: "Самолет", train: "Поезд", car: "Автомобиль" };

          worksheet.addRow([
            trip.number,
            trip.employee?.fullName || "-",
            trip.employee?.department || "-",
            tripDates,
            routePath,
            transportMap[trip.transportType] || trip.transportType,
            trip.nights,
            trip.totalAllowance || 0,
          ]);
        });

        // Subtotal for without allowance
        const subtotalWithoutRow = worksheet.addRow(["", "", "", "", "", "", "Итого по без суточных:", data.totalWithoutAllowance]);
        subtotalWithoutRow.font = { bold: true };
        subtotalWithoutRow.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF5F5F5" } };
      }

      // Empty row before grand total
      worksheet.addRow([]);

      // Grand total
      if ((data.withAllowance && data.withAllowance.length > 0) || (data.withoutAllowance && data.withoutAllowance.length > 0)) {
        const grandTotalRow = worksheet.addRow(["", "", "", "", "", "", "ОБЩИЙ ИТОГ:", data.grandTotal]);
        grandTotalRow.font = { bold: true, size: 12 };
        grandTotalRow.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE0E0E0" } };
      }

      // Adjust column widths
      worksheet.columns = [
        { width: 8 },
        { width: 25 },
        { width: 15 },
        { width: 25 },
        { width: 45 },
        { width: 12 },
        { width: 8 },
        { width: 15 },
      ];
      
      // Generate buffer
      const buffer = await workbook.xlsx.writeBuffer() as Buffer;
      console.log(`[EXPORT] Buffer generated, size: ${buffer.length} bytes`);
      
      // Send file
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      const encodedFileName = encodeURIComponent(`Реестр_командировок_${period.startDate}_по_${period.endDate}.xlsx`);
      res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodedFileName}`);
      console.log(`[EXPORT] Sending file: ${encodedFileName}`);
      res.send(buffer);
    } catch (error) {
      console.error("Export error:", error);
      res.status(500).json({ error: "Failed to export report" });
    }
  });

  // ============ DAILY ALLOWANCE ============
  
  app.get("/api/daily-allowance", async (_req, res) => {
    try {
      const allowance = await storage.getDailyAllowance();
      if (!allowance) {
        // Return default if not set
        return res.json({ amountPerNight: "1700" });
      }
      res.json(allowance);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch daily allowance" });
    }
  });

  app.post("/api/daily-allowance", requireAdmin, async (req, res) => {
    try {
      const parsed = insertDailyAllowanceSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid daily allowance data" });
      }
      const allowance = await storage.updateDailyAllowance(parsed.data.amountPerNight);
      res.json(allowance);
    } catch (error) {
      res.status(500).json({ error: "Failed to update daily allowance" });
    }
  });

  // ============ HOLIDAYS ============

  app.get("/api/holidays", async (_req, res) => {
    try {
      const holidays = await storage.getAllHolidays();
      res.json(holidays);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch holidays" });
    }
  });

  app.post("/api/holidays", requireCoordinatorOrAdmin, async (req, res) => {
    try {
      const parsed = insertHolidaySchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid holiday data" });
      }
      const holiday = await storage.createHoliday(parsed.data);
      res.status(201).json(holiday);
    } catch (error) {
      res.status(500).json({ error: "Failed to create holiday" });
    }
  });

  app.patch("/api/holidays/:id", requireCoordinatorOrAdmin, async (req, res) => {
    try {
      const parsed = insertHolidaySchema.partial().safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid holiday data" });
      }
      const holiday = await storage.updateHoliday(req.params.id, parsed.data);
      if (!holiday) {
        return res.status(404).json({ error: "Holiday not found" });
      }
      res.json(holiday);
    } catch (error) {
      res.status(500).json({ error: "Failed to update holiday" });
    }
  });

  app.delete("/api/holidays/:id", requireCoordinatorOrAdmin, async (req, res) => {
    try {
      const success = await storage.deleteHoliday(req.params.id);
      if (!success) {
        return res.status(404).json({ error: "Holiday not found" });
      }
      res.status(204).send();
    } catch (error) {
      res.status(500).json({ error: "Failed to delete holiday" });
    }
  });

  // ============ USER ACCOUNT ENDPOINTS ============

  // Change password
  app.patch("/api/auth/change-password", async (req, res) => {
    try {
      if (!req.session.userId) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      const { currentPassword, newPassword } = req.body;
      if (!currentPassword || !newPassword) {
        return res.status(400).json({ error: "Current and new password required" });
      }

      const user = await storage.getUser(req.session.userId);
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }

      // Verify current password
      const validated = await storage.validatePassword(user.email, currentPassword);
      if (!validated) {
        return res.status(401).json({ error: "Current password is incorrect" });
      }

      // Validate new password
      const validation = validatePassword(newPassword);
      if (!validation.valid) {
        return res.status(400).json({ error: validation.errors.join(", ") });
      }

      // Update password
      await storage.updateUser(user.id, { password: newPassword } as any);
      res.json({ success: true, message: "Password changed successfully" });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to change password" });
    }
  });

  // Chat contacts: system administrator first, then colleagues and the direct manager.
  const getChatContacts = async (user: User) => {
    const users = await storage.getAllUsers();

    if (["admin", "coordinator"].includes(user.role || "")) {
      return users
        .filter((candidate) => candidate.id !== user.id)
        .sort((first, second) => first.fullName.localeCompare(second.fullName, "ru"));
    }

    const administratorContacts = users
      .filter((candidate) => candidate.id !== user.id && candidate.role === "admin")
      .sort((first, second) => first.fullName.localeCompare(second.fullName, "ru"));
    const contacts = new Map<string, User>();
    for (const candidate of users) {
      if (
        candidate.id !== user.id &&
        user.department &&
        candidate.department === user.department
      ) {
        contacts.set(candidate.id, candidate);
      }
    }

    if (user.managerId) {
      const manager = users.find((candidate) => candidate.id === user.managerId);
      if (manager && manager.id !== user.id) {
        contacts.set(manager.id, manager);
      }
    }

    const otherContacts = Array.from(contacts.values())
      .filter((candidate) => candidate.role !== "admin")
      .sort((first, second) => first.fullName.localeCompare(second.fullName, "ru"));

    return [...administratorContacts, ...otherContacts];
  };

  async function requireCoordinatorOrAdmin(req: any, res: any, next: any) {
    try {
      if (!req.session.userId) return res.status(401).json({ error: "Not authenticated" });
      const user = await storage.getUser(req.session.userId);
      if (!user || !["admin", "coordinator"].includes(user.role || "")) {
        return res.status(403).json({ error: "Only administrators or coordinators can manage this section" });
      }
      next();
    } catch (error) {
      res.status(500).json({ error: "Permission check failed" });
    }
  }

  app.get("/api/chat/contacts", async (req, res) => {
    try {
      if (!req.session.userId) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      const currentUser = await storage.getUser(req.session.userId);
      if (!currentUser) {
        return res.status(404).json({ error: "User not found" });
      }

      res.json(await getChatContacts(currentUser));
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to load chat contacts" });
    }
  });

  app.post("/api/trips/:id/memo", async (req, res) => {
    try {
      if (!req.session.userId) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      const currentUser = await storage.getUser(req.session.userId);
      const trip = await storage.getTripWithDetails(req.params.id);
      if (!currentUser || !trip) {
        return res.status(404).json({ error: "Trip not found" });
      }

      const canGenerate = currentUser.role === "admin" || currentUser.id === trip.employeeId || currentUser.id === trip.employee.managerId;
      if (!canGenerate) {
        return res.status(403).json({ error: "You do not have access to this trip" });
      }

      const kind = req.body?.kind as TripMemoKind;
      if (!["unplanned", "cancel", "reschedule", "change"].includes(kind)) {
        return res.status(400).json({ error: "Unknown memo type" });
      }
      if (kind === "unplanned" && trip.tripType !== "unplanned") {
        return res.status(400).json({ error: "This document is available only for unplanned trips" });
      }
      const sourceTrip = kind === "reschedule" && trip.sourceTripId
        ? await storage.getTripWithDetails(trip.sourceTripId)
        : trip;
      if (!sourceTrip) {
        return res.status(400).json({ error: "The original trip for rescheduling was not found" });
      }
      const newStartDate = typeof req.body?.newStartDate === "string" ? req.body.newStartDate : trip.startDate;
      const newEndDate = typeof req.body?.newEndDate === "string" ? req.body.newEndDate : trip.endDate;
      if (kind === "reschedule" && (!newStartDate || !newEndDate)) {
        return res.status(400).json({ error: "New trip dates are required" });
      }

      const memo = await generateTripMemo(sourceTrip, kind, {
        reason: typeof req.body?.reason === "string" ? req.body.reason.trim() : undefined,
        place: typeof req.body?.place === "string" ? req.body.place.trim() : undefined,
        travelCost: typeof req.body?.travelCost === "string" ? req.body.travelCost.trim() : undefined,
        accommodationCost: typeof req.body?.accommodationCost === "string" ? req.body.accommodationCost.trim() : undefined,
        otherCost: typeof req.body?.otherCost === "string" ? req.body.otherCost.trim() : undefined,
        newStartDate,
        newEndDate,
        newPurpose: typeof req.body?.newPurpose === "string" ? req.body.newPurpose.trim() : undefined,
      });

      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
      res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(memo.fileName)}`);
      res.send(memo.buffer);
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to generate memo" });
    }
  });

  app.get("/api/chat/messages", async (req, res) => {
    try {
      if (!req.session.userId) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      const currentUser = await storage.getUser(req.session.userId);
      if (!currentUser) {
        return res.status(404).json({ error: "User not found" });
      }

      const correspondentId = typeof req.query.userId === "string" ? req.query.userId : undefined;

      if (!correspondentId || correspondentId === currentUser.id) {
        return res.json([]);
      }

      const correspondent = await storage.getUser(correspondentId);
      const contacts = await getChatContacts(currentUser);
      const isAllowed = currentUser.role === "admin" || contacts.some((contact) => contact.id === correspondentId);
      if (!correspondent || !isAllowed) {
        return res.status(403).json({ error: "Chat is not available with this user" });
      }

      const messages = await storage.getChatMessagesBetweenUsers(currentUser.id, correspondentId);
      await storage.markChatMessagesAsRead(currentUser.id, correspondentId);
      res.json(messages);
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to load chat messages" });
    }
  });

  app.post("/api/chat/messages", async (req, res) => {
    try {
      if (!req.session.userId) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      const currentUser = await storage.getUser(req.session.userId);
      const message = typeof req.body?.message === "string" ? req.body.message.trim() : "";
      if (!currentUser) {
        return res.status(404).json({ error: "User not found" });
      }
      if (!message || message.length > 5000) {
        return res.status(400).json({ error: "Message must contain from 1 to 5000 characters" });
      }

      const recipientId = typeof req.body?.toUserId === "string" ? req.body.toUserId : undefined;

      if (!recipientId || recipientId === currentUser.id) {
        return res.status(400).json({ error: "Recipient is required" });
      }

      const recipient = await storage.getUser(recipientId);
      const contacts = await getChatContacts(currentUser);
      const isAllowed = currentUser.role === "admin" || contacts.some((contact) => contact.id === recipientId);
      if (!recipient || !isAllowed) {
        return res.status(403).json({ error: "Chat is not available with this user" });
      }

      const savedMessage = await storage.saveChatMessage({
        fromUserId: currentUser.id,
        toUserId: recipientId,
        message,
      });
      void sendEmail({
        to: recipient.email,
        subject: "Новое сообщение в чате - Планировщик командировок",
        html: generateChatNotificationEmail(recipient.fullName, currentUser.fullName),
      });
      res.status(201).json(savedMessage);
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to send chat message" });
    }
  });

  app.get("/api/chat/unread-count", async (req, res) => {
    try {
      if (!req.session.userId) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      const unreadMessages = await storage.getUnreadChatMessages(req.session.userId);
      const users = await storage.getAllUsers();
      const usersById = new Map(users.map((user) => [user.id, user]));
      const senders = Array.from(new Map(
        unreadMessages
          .map((message) => {
            const sender = usersById.get(message.fromUserId);
            return sender ? {
              id: sender.id,
              fullName: sender.fullName,
              latestMessageId: message.id,
              latestMessageAt: message.createdAt,
            } : null;
          })
          .filter((sender): sender is NonNullable<typeof sender> => sender !== null)
          .map((sender) => [sender.id, sender]),
      ).values()).slice(0, 3);
      res.json({ count: unreadMessages.length, senders });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to load unread chat count" });
    }
  });

  app.get("/api/chat/threads", requireAdmin, async (req, res) => {
    try {
      const currentUserId = req.session.userId as string;
      const [users, messages] = await Promise.all([
        storage.getAllUsers(),
        storage.getAllChatMessages(),
      ]);
      const threads = users
        .filter((user) => user.id !== currentUserId && user.role !== "admin")
        .map((user) => {
          const latestMessage = messages.find((message) =>
            (message.fromUserId === user.id && message.toUserId === currentUserId) ||
            (message.fromUserId === currentUserId && message.toUserId === user.id),
          );
          const unreadCount = messages.filter((message) =>
            message.fromUserId === user.id && message.toUserId === currentUserId && message.isRead === "false",
          ).length;
          return { user, latestMessage: latestMessage ?? null, unreadCount };
        })
        .sort((first, second) => {
          if (first.latestMessage && second.latestMessage) {
            return new Date(second.latestMessage.createdAt).getTime() - new Date(first.latestMessage.createdAt).getTime();
          }
          return Number(Boolean(second.latestMessage)) - Number(Boolean(first.latestMessage));
        });
      res.json(threads);
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to load chat threads" });
    }
  });

  // Contact admin (send message)
  app.post("/api/contact-admin", async (req, res) => {
    try {
      if (!req.session.userId) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      const { subject, message, attachment } = await readMultipartFields(req);
      if (!subject || !message) {
        return res.status(400).json({ error: "Subject and message required" });
      }

      const user = await storage.getUser(req.session.userId);
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }

      // Save message to database so admin can see it in the admin panel
      await storage.saveContactMessage({
        fromUserId: user.id,
        fromUserName: user.fullName,
        fromUserEmail: user.email,
        subject,
        message,
        attachmentUrl: attachment?.buffer && attachment?.filename ? (() => {
          const safeName = `${Date.now()}-${randomUUID()}-${attachment.filename}`.replace(/[^a-zA-Z0-9._-]/g, "_");
          fs.writeFileSync(path.join(attachmentsDir, safeName), attachment.buffer);
          cleanupOldAttachments();
          return attachmentUrl(safeName);
        })() : undefined,
        attachmentName: attachment?.filename,
        attachmentContentType: attachment?.mimetype,
      });

      // Also try to send email (may fail silently if SMTP not configured)
      try {
        const admins = (await storage.getAllUsers()).filter(u => u.role === "admin");
        if (admins.length > 0) {
          const adminEmail = admins[0].email;
          const emailContent = generateContactAdminEmail(user.fullName, user.email, subject, message);
          await sendEmail({
            to: adminEmail,
            subject: `Сообщение от пользователя: ${subject}`,
            html: emailContent,
          });
        }
      } catch (_) {}

      res.json({ success: true, message: "Message sent to admin" });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to send message" });
    }
  });

  // Get all contact messages (admin only)
  app.get("/api/admin/messages", requireAdmin, async (req, res) => {
    try {
      const messages = await storage.getAllContactMessages();
      res.json(messages);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Get unread message count (admin only)
  app.get("/api/admin/messages/unread-count", requireAdmin, async (req, res) => {
    try {
      const count = await storage.getUnreadMessageCount();
      res.json({ count });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Mark message as read (admin only)
  app.patch("/api/admin/messages/:id/read", requireAdmin, async (req, res) => {
    try {
      await storage.markMessageAsRead(req.params.id);
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.delete("/api/admin/messages", requireAdmin, async (req, res) => {
    try {
      await storage.clearContactMessages();
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Send credentials to all users (admin only)
  app.post("/api/users/send-credentials", requireAdmin, async (req, res) => {
    try {
      const allUsers = await storage.getAllUsers();
      const nonAdminUsers = allUsers.filter(u => u.role !== "admin");

      if (nonAdminUsers.length === 0) {
        return res.status(400).json({ error: "No users to send credentials to" });
      }

      const results = {
        sent: 0,
        failed: 0,
        errors: [] as string[],
      };

      for (const user of nonAdminUsers) {
        try {
          const newPassword = generateRandomPassword(8);
          const emailContent = generateCredentialEmail(user.fullName, user.email, newPassword);
          const previousPasswordHash = user.password;

          const updatedUser = await storage.updateUser(user.id, { password: newPassword } as any);
          if (!updatedUser) {
            throw new Error("User was not found while updating the password");
          }

          const emailSent = await sendEmail({
            to: user.email,
            subject: "Учетные данные системы управления командировками",
            html: emailContent,
          });

          if (!emailSent) {
            await storage.restoreUserPasswordHash(user.id, previousPasswordHash);
            throw new Error("Email delivery was not accepted; the previous password was restored");
          }

          results.sent++;
          console.log(`[CREDENTIALS] Sent to ${user.email}`);
        } catch (error: any) {
          results.failed++;
          results.errors.push(`${user.email}: ${error.message}`);
          console.error(`[CREDENTIALS] Failed to send to ${user.email}:`, error);
        }
      }

      res.json({
        success: true,
        message: `Credentials sent to ${results.sent} users${results.failed > 0 ? `, ${results.failed} failed` : ""}`,
        results,
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to send credentials" });
    }
  });

  // Reset one user's password and deliver it only to that user's work email.
  app.post("/api/users/:id/reset-password", requireAdmin, async (req, res) => {
    try {
      const targetUser = await storage.getUser(req.params.id);
      if (!targetUser) {
        return res.status(404).json({ error: "User not found" });
      }

      const newPassword = generateRandomPassword(8);
      const previousPasswordHash = targetUser.password;
      const updatedUser = await storage.updateUser(targetUser.id, { password: newPassword } as any);
      if (!updatedUser) {
        return res.status(404).json({ error: "User not found while updating the password" });
      }

      const emailSent = await sendEmail({
        to: targetUser.email,
        subject: "Восстановление доступа к системе командировок",
        html: generatePasswordResetEmail(targetUser.fullName, targetUser.email, newPassword),
      });

      if (!emailSent) {
        await storage.restoreUserPasswordHash(targetUser.id, previousPasswordHash);
        return res.status(502).json({
          error: "Письмо не было принято почтовым сервером. Прежний пароль сохранен.",
        });
      }

      console.log(`[PASSWORD RESET] Sent to ${targetUser.email}`);
      res.json({ success: true, email: targetUser.email });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to reset password" });
    }
  });

  const httpServer = createServer(app);
  return httpServer;
}
