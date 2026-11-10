Warning: truncated output (original token count: 38255)
Total output lines: 3408

import type { Express } from "express";
import { createServer, type Server } from "http";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "crypto";
import ExcelJS from "exceljs";
import { sql } from "drizzle-orm";
import { db } from "./db";
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
import { sendEmail, generateChatNotificationEmail, generateCredentialEmail, generateNewUserCredentialEmail, generatePasswordResetEmail, generateContactAdminEmail } from "./email-service";
import { generateRandomPassword, validatePassword } from "./password-utils";
import { generateTripMemo, type TripMemoKind } from "./trip-memo-generator";
import {
  buildAuthorizationUrl,
  createOidcTransaction,
  decodeOidcState,
  exchangeCode,
  isYandexOidcEnabled,
} from "./yandex-oidc";

export async function registerRoutes(app: Express): Promise<Server> {
  const attachmentsDir = path.resolve(import.meta.dirname, "..", "uploads", "contact-screenshots");

  type CredentialBroadcastStatus = "idle" | "running" | "completed" | "interrupted";
  type CredentialBroadcastProgress = {
    status: CredentialBroadcastStatus;
    total: number;
    sent: number;
    failed: number;
    startedAt?: string;
    completedAt?: string;
  };

  let credentialBroadcast: CredentialBroadcastProgress = {
    status: "idle",
    total: 0,
    sent: 0,
    failed: 0,
  };
  let credentialBroadcastId: string | null = null;
  let credentialBroadcastTableReady: Promise<void> | null = null;
  let loginSessionTableReady: Promise<void> | null = null;

  function ensureLoginSessionTable(): Promise<void> {
    if (!loginSessionTableReady) {
      loginSessionTableReady = db.execute(sql`
        CREATE TABLE IF NOT EXISTS trip_planner_login_sessions (
          id varchar PRIMARY KEY,
          user_id varchar NOT NULL,
          full_name text NOT NULL,
          email text NOT NULL,
          session_id varchar NOT NULL,
          login_at timestamptz NOT NULL DEFAULT now(),
          logout_at timestamptz,
          duration_seconds integer,
          end_reason text
        )
      `).then(() => undefined);
    }
    return loginSessionTableReady;
  }

  async function startLoginSession(req: any, user: User) {
    try {
      await ensureLoginSessionTable();
      const loginSessionId = randomUUID();
      await db.execute(sql`
        INSERT INTO trip_planner_login_sessions (id, user_id, full_name, email, session_id)
        VALUES (${loginSessionId}, ${user.id}, ${user.fullName}, ${user.email}, ${req.sessionID})
      `);
      req.session.loginSessionId = loginSessionId;
    } catch (error) {
      // Audit logging must not block a legitimate user login.
      console.error("[SESSION-AUDIT] Failed to record login:", error);
    }
  }

  async function finishLoginSession(req: any, endReason: string) {
    const loginSessionId = req.session?.loginSessionId;
    if (!loginSessionId) return;
    try {
      await ensureLoginSessionTable();
      await db.execute(sql`
        UPDATE trip_planner_login_sessions
        SET logout_at = now(),
            duration_seconds = GREATEST(0, EXTRACT(EPOCH FROM now() - login_at)::integer),
            end_reason = ${endReason}
        WHERE id = ${loginSessionId} AND logout_at IS NULL
      `);
    } catch (error) {
      console.error("[SESSION-AUDIT] Failed to record logout:", error);
    }
  }

  function ensureCredentialBroadcastTable(): Promise<void> {
    if (!credentialBroadcastTableReady) {
      credentialBroadcastTableReady = db.execute(sql`
        CREATE TABLE IF NOT EXISTS trip_planner_credential_broadcasts (
          id varchar PRIMARY KEY,
          status text NOT NULL,
          total integer NOT NULL,
          sent integer NOT NULL DEFAULT 0,
          failed integer NOT NULL DEFAULT 0,
          started_at timestamptz NOT NULL DEFAULT now(),
          completed_at timestamptz
        )
      `).then(() => undefined);
    }
    return credentialBroadcastTableReady;
  }

  async function saveCredentialBroadcastProgress() {
    if (!credentialBroadcastId) return;
    try {
      await db.execute(sql`
        UPDATE trip_planner_credential_broadcasts
        SET status = ${credentialBroadcast.status},
            sent = ${credentialBroadcast.sent},
            failed = ${credentialBroadcast.failed},
            completed_at = ${credentialBroadcast.completedAt || null}
        WHERE id = ${credentialBroadcastId}
      `);
    } catch (error) {
      // Do not stop already accepted email delivery because the audit write failed.
      console.error("[CREDENTIALS] Failed to save broadcast progress:", error);
    }
  }

  async function getLastCredentialBroadcast(): Promise<CredentialBroadcastProgress> {
    await ensureCredentialBroadcastTable();
    const result = await db.execute(sql`
      SELECT status, total, sent, failed, started_at, completed_at
      FROM trip_planner_credential_broadcasts
      ORDER BY started_at DESC
      LIMIT 1
    `);
    const row = result.rows[0] as {
      status: CredentialBroadcastStatus;
      total: number;
      sent: number;
      failed: number;
      started_at: Date | string;
      completed_at: Date | string | null;
    } | undefined;

    if (!row) return credentialBroadcast;
    return {
      status: row.status,
      total: Number(row.total),
      sent: Number(row.sent),
      failed: Number(row.failed),
      startedAt: new Date(row.started_at).toISOString(),
      completedAt: row.completed_at ? new Date(row.completed_at).toISOString() : undefined,
    };
  }

  const wait = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

  async function runCredentialBroadcast(users: User[]) {
    for (let index = 0; index < users.length; index += 1) {
      const user = users[index];
      try {
        const newPassword = generateRandomPassword(8);
        const emailContent = generateCredentialEmail(user.fullName, user.email, newPassword);

        const emailSent = await sendEmail({
          to: user.email,
          subject: "Тестовый период приложения для командировок: доступ к системе",
          html: emailContent,
        });

        if (!emailSent) {
          throw new Error("Email delivery was not accepted; the previous password was kept");
        }

        const updatedUser = await storage.updateUser(user.id, { password: newPassword } as any);
        if (!updatedUser) {
          throw new Error("Email was sent, but the user was not found while updating the password");
        }

        credentialBroadcast.sent += 1;
        await saveCredentialBroadcastProgress();
        console.log(`[CREDENTIALS] Sent to ${user.email}`);
      } catch (error) {
        credentialBroadcast.failed += 1;
        await saveCredentialBroadcastProgress();
        console.error(`[CREDENTIALS] Failed to send to ${user.email}:`, error);
      }

      // Keep the provider-friendly pace requested for this campaign.
      if (index < users.length - 1) {
        await wait(5000);
      }
    }

    credentialBroadcast = {
      ...credentialBroadcast,
      status: "completed",
      completedAt: new Date().toISOString(),
    };
    await saveCredentialBroadcastProgress();
  }

  if (!fs.existsSync(attachmentsDir)) {
    fs.mkdirSync(attachmentsDir, { recursive: true });
  }
  app.use("/uploads/contact-screenshots", (req, res, next) => {
    if (!req.session.userId) {
      return res.status(401).json({ error: "Not authenticated" });
    }
    const fileName = decodeURIComponent(req.path).replace(/^\/+/, "");
    const filePath = path.join(attachmentsDir, fileName);
    if (path.relative(attachmentsDir, filePath).startsWith("..") || path.isAbsolute(fileName)) {
      return res.status(400).json({ error: "Invalid file path" });
    }
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
  const allTripsViewerRoles = new Set(["admin", "ceo", "deputy_ceo", "coordinator", "accountant", "hr_director"]);
  const departmentLeaderRoles = new Set(["marketing_director", "sales_director", "commerce_director"]);
  const requiredWorkflowRoles = new Set(["coordinator", "deputy_ceo", "ceo"]);
  const defaultWorkflowDeputyCeoName = "Горельский Евгений Александрович";

  async function getRequiredWorkflowReviewer(role: "coordinator" | "deputy_ceo" | "ceo") {
    const reviewers = (await storage.getAllUsers()).filter((user) => user.role === role && user.employmentStatus === "active");
    if (role === "deputy_ceo") {
      const configuredDeputyId = process.env.WORKFLOW_DEPUTY_CEO_ID?.trim();
      const configuredDeputyName = process.env.WORKFLOW_DEPUTY_CEO_NAME?.trim() || defaultWorkflowDeputyCeoName;
      const selectedDeputies = configuredDeputyId
        ? reviewers.filter((user) => user.id === configuredDeputyId)
        : reviewers.filter((user) => user.fullName === configuredDeputyName);
      if (selectedDeputies.length === 1) return selectedDeputies[0];
      throw new Error(`Для маршрута согласования должен быть назначен ЗГД: ${configuredDeputyName}`);
    }
    if (reviewers.length !== 1) {
      const label = role === "coordinator"
        ? "координатора"
        : "генерального директора";
      throw new Error(`Для маршрута согласования должен быть назначен один ${label}`);
    }
    return reviewers[0];
  }

  async function createPendingApproval(tripId: string, approverId: string) {
    await storage.createApproval({ tripId, approverId, status: "pending" });
  }

  async function submitTripForWorkflow(trip: Trip) {
    const employee = await storage.getUser(trip.employeeId);
    if (!employee) throw new Error("Сотрудник для командировки не найден");

    const directManager = employee.managerId ? await storage.getUser(employee.managerId) : undefined;
    if (directManager && !requiredWorkflowRoles.has(directManager.role || "")) {
      await storage.updateTrip(trip.id, { status: "pending" });
      await createPendingApproval(trip.id, directManager.id);
      return;
    }

    const coordinator = await getRequiredWorkflowReviewer("coordinator");
    await storage.updateTrip(trip.id, { status: "coordinator_review" });
    await createPendingApproval(trip.id, coordinator.id);
  }

  function getMoscowDateParts(date = new Date()) {
    const values = new Intl.DateTimeFormat("en-US", {
      timeZone: "Europe/Moscow",
      year: "numeric",
      month: "numeric",
      day: "numeric",
    }).formatToParts(date);
    const part = (type: string) => Number(values.find((value) => value.type === type)?.value);
    return { year: part("year"), month: part("month"), day: part("day") };
  }

  function isNextMonthPlanWindow(trip: Pick<Trip, "tripType" | "startDate" | "endDate">) {
    if (trip.tripType !== "planned") return true;
    const today = getMoscowDateParts();
    const nextMonth = today.month === 12 ? 1 : today.month + 1;
    const nextYear = today.month === 12 ? today.year + 1 : today.year;
    const expectedMonth = `${nextYear}-${String(nextMonth).padStart(2, "0")}`;
    return today.day <= 25 && trip.startDate.startsWith(expectedMonth);
  }

  async function assertTripPlanningWindow(
    trip: Pick<Trip, "tripType" | "startDate" | "endDate"> & { id?: string },
  ) {
    if (!isNextMonthPlanWindow(trip)) {
      throw new Error("Плановую командировку можно отправить до 25-го числа текущего месяца и только на следующий месяц. Для другой даты оформите внеплановую командировку.");
    }

    if (trip.tripType !== "planned") return;

    const planningMonth = trip.startDate.slice(0, 7);
    const plansAlreadyConfirmed = (await storage.getAllTrips()).some((existingTrip) =>
      existingTrip.id !== trip.id &&
      existingTrip.tripType === "planned" &&
      existingTrip.status === "planned" &&
      existingTrip.startDate.slice(0, 7) === planningMonth,
    );
    if (plansAlreadyConfirmed) {
      throw new Error("План командировок на этот месяц уже утвержден генеральным директором. Новые поездки оформляйте как внеплановые.");
    }
  }

  async function advanceApprovedTrip(trip: Trip, approver: User) {
    if (approver.role === "coordinator") {
      if (trip.status === "awaiting_ceo_signature") {
        const ceo = await getRequiredWorkflowReviewer("ceo");
        await createPendingApproval(trip.id, ceo.id);
        return;
      }

      const deputy = await getRequiredWorkflowReviewer("deputy_ceo");
      await storage.updateTrip(trip.id, { status: "deputy_review" });
      await createPendingApproval(trip.id, deputy.id);
      return;
    }

    if (approver.role === "deputy_ceo") {
      const ceo = await getRequiredWorkflowReviewer("ceo");
      await storage.updateTrip(trip.id, {
        status: trip.tripType === "planned" ? "awaiting_ceo_signature" : "ceo_review",
      });
      await createPendingApproval(trip.id, ceo.id);
      return;
    }

    if (approver.role === "ceo") {
      if (trip.tripType === "planned" && trip.status === "awaiting_ceo_signature") {
        await storage.updateTrip(trip.id, { status: "planned" });
        return;
      }
      if (trip.tripType === "unplanned" && trip.status === "ceo_review") {
        await storage.updateTrip(trip.id, { status: "approved" });
        return;
      }
      throw new Error("Генеральный директор подтверждает командировки только на финальном этапе");
    }

    const nextManager = approver.managerId ? await storage.getUser(approver.managerId) : undefined;
    if (nextManager && !requiredWorkflowRoles.has(nextManager.role || "")) {
      await storage.updateTrip(trip.id, { status: "pending" });
      await createPendingApproval(trip.id, nextManager.id);
      return;
    }

    const coordinator = await getRequiredWorkflowReviewer("coordinator");
    await storage.updateTrip(trip.id, { status: "coordinator_review" });
    await createPendingApproval(trip.id, coordinator.id);
  }

  function withoutPassword<T extends { password?: unknown }>(user: T) {
    const { password: _password, ...safeUser } = user;
    return safeUser;
  }

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

  function authErrorRedirect(message: string) {
    return `/login?authError=${encodeURIComponent(message)}`;
  }

  function setAuthNoStore(res: any) {
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, private");
    res.setHeader("Pragma", "no-cache");
  }

  app.get("/api/auth/yandex/status", (_req, res) => {
    setAuthNoStore(res);
    res.json({ enabled: isYandexOidcEnabled() });
  });

  app.get("/api/auth/yandex/start", (req, res) => {
    setAuthNoStore(res);
    if (!isYandexOidcEnabled()) return res.redirect(authErrorRedirect("Корпоративный вход пока не настроен"));
    const transaction = createOidcTransaction();
    req.session.oidcState = transaction.state;
    req.session.oidcNonce = transaction.nonce;
    req.session.oidcCodeVerifier = transaction.verifier;
    req.session.oidcReturnTo = "/";
    const requestedAccountSwitch = String(req.query.account || "") === "other";
    buildAuthorizationUrl(transaction, requestedAccountSwitch ? "login" : (process.env.OIDC_PROMPT?.trim() || "select_account"))
      .then((authorizationUrl) => req.session.save((error) => {
      if (error) {
        console.error("[OIDC] Failed to save authorization session:", error);
        return res.redirect(authErrorRedirect("Не удалось начать корпоративный вход"));
      }
      res.redirect(authorizationUrl.toString());
      }))
      .catch((error) => {
        console.error("[OIDC] Failed to build authorization URL:", error);
        res.redirect(authErrorRedirect("Корпоративный вход временно недоступен"));
      });
  });

  app.get("/api/auth/yandex/callback", async (req, res) => {
    setAuthNoStore(res);
    const { code, state, error } = req.query as Record<string, string | undefined>;
    if (error) return res.redirect(authErrorRedirect("Вход через Яндекс был отменен"));
    const signedState = state ? decodeOidcState(state) : null;
    const codeVerifier = req.session.oidcCodeVerifier || signedState?.verifier;
    const nonce = req.session.oidcNonce || signedState?.nonce;
    const expectedState = req.session.oidcState || (signedState ? state : undefined);
    const returnTo = req.session.oidcReturnTo || "/";
    delete req.session.oidcState;
    delete req.session.oidcNonce;
    delete req.session.oidcCodeVerifier;
    delete req.session.oidcReturnTo;
    if (!code || !state || !expectedState || state !== expectedState || !codeVerifier || !nonce) {
      return res.redirect(authErrorRedirect("Сессия входа истекла. Нажмите кнопку входа еще раз."));
    }

    try {
      const claims = await exchangeCode(code, codeVerifier, nonce);
      const email = String(claims.email || claims.default_email || "").trim().toLowerCase();
      if (!email) throw new Error("Corporate email is missing");

      const user = await storage.getUserByEmail(email);
      if (!user) return res.redirect(authErrorRedirect("Пользователь не найден в списке доступа"));
      if (user.employmentStatus !== "active") return res.redirect(authErrorRedirect("Доступ пользователя отключен"));

      // The signed fallback cookie is the recovery path for serverless
      // instances. Do not reject a valid corporate login merely because the
      // shared PostgreSQL session store is temporarily unavailable.
      try {
        await new Promise<void>((resolve, reject) => req.session.regenerate((saveError) => saveError ? reject(saveError) : resolve()));
      } catch (sessionError) {
        console.error("[OIDC] Session regeneration failed; using current session:", sessionError);
      }
      req.session.userId = user.id;
      req.session.userEmail = user.email;
      await startLoginSession(req, user);
      try {
        await new Promise<void>((resolve, reject) => req.session.save((saveError) => saveError ? reject(saveError) : resolve()));
      } catch (sessionError) {
        console.error("[OIDC] Session save failed; using fallback cookie:", sessionError);
      }
      // Serverless requests may be handled by another instance immediately
      // after the callback. Keep a signed fallback cookie so the first
      // application request can restore the authenticated user reliably.
      res.locals.setFallbackAuthCookie(res, user.id, user.email);
      return res.redirect(returnTo);
    } catch (callbackError) {
      console.error("[OIDC] Callback failed:", callbackError);
      return res.redirect(authErrorRedirect("Не удалось выполнить корпоративный вход"));
    }
  });
  
  // Локальный парольный вход оставлен только для отдельной учетной записи администратора.
  app.post("/api/auth/admin-login", async (req, res) => {
    setAuthNoStore(res);
    try {
      const email = String(req.body?.email || "").trim().toLowerCase();
      const password = String(req.body?.password || "");
      if (!email || !password) return res.status(400).json({ error: "Введите логин и пароль администратора" });
      const user = await storage.validatePassword(email, password);
      if (!user || user.role !== "admin") return res.status(401).json({ error: "Неверный логин или пароль администратора" });
      if (user.employmentStatus !== "active") return res.status(403).json({ error: "Учетная запись администратора отключена" });
      await new Promise<void>((resolve, reject) => req.session.regenerate((saveError) => saveError ? reject(saveError) : resolve()));
      req.session.userId = user.id;
      req.session.userEmail = user.email;
      await startLoginSession(req, user);
      await new Promise<void>((resolve, reject) => req.session.save((saveError) => saveError ? reject(saveError) : resolve()));
      res.locals.setFallbackAuthCookie(res, user.id, user.email);
      return res.json({ success: true });
    } catch (error) {
      console.error("[AUTH] Admin login session error:", error);
      return res.status(500).json({ error: "Не удалось сохранить сессию администратора. Проверьте подключение базы и повторите вход." });
    }
  });

  // Вход по email и паролю из trip_planner_users. Используется как основной
  // способ проверки приложения без внешнего провайдера авторизации.
  app.post("/api/auth/password-login", async (req, res) => {
    setAuthNoStore(res);
    try {
      const email = String(req.body?.email || "").trim().toLowerCase();
      const password = String(req.body?.password || "");
      if (!email || !password) return res.status(400).json({ error: "Введите email и пароль" });
      const user = await storage.validatePassword(email, password);
      if (!user) return res.status(401).json({ error: "Неверный email или пароль" });
      if (user.employmentStatus !== "active") return res.status(403).json({ error: "Учетная запись отключена" });
      await new Promise<void>((resolve, reject) => req.session.regenerate((saveError) => saveError ? reject(saveError) : resolve()));
      req.session.userId = user.id;
      req.session.userEmail = user.email;
      await startLoginSession(req, user);
      await new Promise<void>((resolve, reject) => req.session.save((saveError) => saveError ? reject(saveError) : resolve()));
      res.locals.setFallbackAuthCookie(res, user.id, user.email);
      return res.json({ success: true });
    } catch (error) {
      console.error("[AUTH] Password login session error:", error);
      return res.status(500).json({ error: "Не удалось сохранить сессию. Проверьте подключение базы и повторите вход." });
    }
  });

  // Logout
  app.post("/api/auth/logout", async (req, res) => {
    setAuthNoStore(res);
    await finishLoginSession(req, "logout");
    res.locals.clearFallbackAuthCookie(res);
    req.session.destroy((err) => {
      if (err) {
        return res.status(500).json({ error: "Logout failed" });
      }
      res.json({ success: true });
    });
  });

  // Get session
  app.get("/api/auth/session", async (req, res) => {
    setAuthNoStore(res);
    try {
      if (!req.session.userId && !req.session.userEmail) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      const user = req.session.userId ? await storage.getUser(req.session.userId) : undefined;
      const resolvedUser = user || (req.session.userEmail ? await storage.getUserByEmail(req.session.userEmail) : undefined);
      if (!resolvedUser) return res.status(401).json({ error: "User not found" });

      // Keep both identifiers synchronized when the session store restores only
      // the email field after a container restart or a transient DB session miss.
      req.session.userId = resolvedUser.id;
      req.session.userEmail = resolvedUser.email;

      const { password: _, ...userWithoutPassword } = resolvedUser;
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

      await finishLoginSession(req, "switched_user");

      // Switch session to target user
      req.session.userId = userId;
      await startLoginSession(req, targetUser);
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

      if (role === "admin" || role === "ceo" || role === "coordinator" || role === "accountant" || role === "hr_director") {
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

      const includeInactive = req.query.includeInactive === "true" && ["admin", "coordinator"].includes(currentUser.role || "");
      if (!includeInactive) users = users.filter((candidate) => candidate.employmentStatus === "active");
      res.json(users
        .sort((first, second) => first.fullName.localeCompare(second.fullName, "ru"))
        .map(withoutPassword));
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch users" });
    }
  });

  // Get user by ID
  app.get("/api/users/:id", async (req, res) => {
    try {
      const currentUser = req.session.userId ? await storage.getUser(req.session.userId) : null;
      if (!currentUser) return res.status(401).json({ error: "Not authenticated" });
      const visibleUsers = await (async () => {
        const all = await storage.getAllUsers();
        if (allTripsViewerRoles.has(currentUser.role || "")) return all;
        if (currentUser.id === req.params.id) return [currentUser];
        return (await storage.getUsersByManager(currentUser.managerId || "")).concat(
          currentUser.managerId ? [await storage.getUser(currentUser.managerId)].filter(Boolean) as User[] : [],
        );
      })();
      if (!visibleUsers.some((candidate) => candidate.id === req.params.id)) {
        return res.status(403).json({ error: "You do not have access to this user" });
      }
      const user = await storage.getUser(req.params.id);
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }
      res.json(withoutPassword(user));
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
  app.post("/api/cities", requireCoordinatorOrAdmin, async (req, res) => {
    try {
      const data = insertCitySchema.parse(req.body);
      
      // Check for duplicate
      const existing = await storage.getCityByName(data.name);
      if (existing…18255 tokens truncated…ТОГ:", data.grandTotal]);
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
        { width: 16 },
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
      res.status(422).json({ error: error instanceof Error ? error.message : "Не удалось выгрузить реестр" });
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

  // Chat contacts: system administrator and coordinator first, then colleagues and the direct manager.
  const getChatContacts = async (user: User) => {
    const users = (await storage.getAllUsers()).filter((candidate) => candidate.employmentStatus === "active");

    if (["admin", "coordinator"].includes(user.role || "")) {
      return users
        .filter((candidate) => candidate.id !== user.id)
        .sort((first, second) => first.fullName.localeCompare(second.fullName, "ru"));
    }

    const supportContacts = users
      .filter((candidate) => candidate.id !== user.id && ["admin", "coordinator"].includes(candidate.role || ""))
      .sort((first, second) => {
        const roleOrder = (candidate: User) => candidate.role === "admin" ? 0 : 1;
        return roleOrder(first) - roleOrder(second) || first.fullName.localeCompare(second.fullName, "ru");
      });
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
      .filter((candidate) => !["admin", "coordinator"].includes(candidate.role || ""))
      .sort((first, second) => first.fullName.localeCompare(second.fullName, "ru"));

    return [...supportContacts, ...otherContacts];
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

  async function requireRegistryAccess(req: any, res: any, next: any) {
    try {
      if (!req.session.userId) return res.status(401).json({ error: "Not authenticated" });
      const user = await storage.getUser(req.session.userId);
      if (!user || !["admin", "coordinator", "accountant", "hr_manager", "hr_director"].includes(user.role || "")) {
        return res.status(403).json({ error: "Registry is available only to administrators, coordinators and accounting" });
      }
      next();
    } catch (error) {
      res.status(500).json({ error: "Permission check failed" });
    }
  }

  async function requireAnalyticsAccess(req: any, res: any, next: any) {
    try {
      if (!req.session.userId) return res.status(401).json({ error: "Not authenticated" });
      const user = await storage.getUser(req.session.userId);
      if (!user || !["admin", "coordinator", "accountant", "hr_director", "ceo", "deputy_ceo"].includes(user.role || "")) {
        return res.status(403).json({ error: "Analytics is available only to management" });
      }
      next();
    } catch (error) {
      res.status(500).json({ error: "Permission check failed" });
    }
  }

  app.get("/api/analytics", requireAnalyticsAccess, async (req, res) => {
    try {
      const currentYear = new Date().getFullYear();
      const from = typeof req.query.from === "string" && /^\d{4}-\d{2}-\d{2}$/.test(req.query.from)
        ? req.query.from
        : `${currentYear}-01-01`;
      const to = typeof req.query.to === "string" && /^\d{4}-\d{2}-\d{2}$/.test(req.query.to)
        ? req.query.to
        : `${currentYear}-12-31`;
      if (from > to) return res.status(400).json({ error: "Дата начала периода не может быть позже даты окончания" });

      const [allTrips, users, routes, approvals, chatMessages, contactMessages, allowance] = await Promise.all([
        storage.getAllTrips(),
        storage.getAllUsers(),
        storage.getAllRoutes(),
        Promise.all((await storage.getAllTrips()).map((trip) => storage.getApprovalsByTrip(trip.id))).then((items) => items.flat()),
        storage.getAllChatMessages(),
        storage.getAllContactMessages(),
        storage.getDailyAllowance(),
      ]);

      const usersById = new Map(users.map((user) => [user.id, user]));
      const routesById = new Map(routes.map((route) => [route.id, route]));
      const tripsInPeriod = allTrips.filter((trip) => trip.startDate <= to && trip.endDate >= from);
      const tripIds = new Set(tripsInPeriod.map((trip) => trip.id));
      const allowancePerNight = Number(String(allowance?.amountPerNight || "0").replace(/[^0-9.,-]/g, "").replace(",", ".")) || 0;
      const dateAtMidnight = (value: string) => new Date(`${value}T00:00:00`);
      const tripDays = (trip: Trip) => Math.max(1, Math.round((dateAtMidnight(trip.endDate).getTime() - dateAtMidnight(trip.startDate).getTime()) / 86400000) + 1);
      const allowanceDays = (trip: Trip) => tripDays(trip) === 1 && trip.transportType === "car" ? 0 : tripDays(trip);
      const tripKilometers = (trip: Trip) => Number(String(routesById.get(trip.routeId)?.kilometers || "0").replace(/[^0-9.,-]/g, "").replace(",", ".")) || 0;
      const increment = <T extends Record<string, number>>(collection: Map<string, T>, key: string, defaults: T) => {
        const row = collection.get(key) || { ...defaults };
        collection.set(key, row);
        return row;
      };

      const departmentStats = new Map<string, { trips: number; approved: number; pending: number; days: number; estimatedCost: number; kilometers: number }>();
      const employeeStats = new Map<string, { trips: number; approved: number; days: number; estimatedCost: number; kilometers: number }>();
      const routeStats = new Map<string, { trips: number; kilometers: number }>();
      const transport = { plane: 0, train: 0, car: 0 };
      const statusCounts = new Map<string, number>();
      const typeCounts = { planned: 0, unplanned: 0 };
      const monthCounts = new Map<string, { total: number; planned: number; unplanned: number }>();

      for (const trip of tripsInPeriod) {
        const employee = usersById.get(trip.employeeId);
        const department = employee?.department || "Без отдела";
        const days = tripDays(trip);
        const estimatedCost = allowanceDays(trip) * allowancePerNight;
        const kilometers = tripKilometers(trip);
        const departmentRow = increment(departmentStats, department, { trips: 0, approved: 0, pending: 0, days: 0, estimatedCost: 0, kilometers: 0 });
        departmentRow.trips += 1;
        departmentRow.approved += ["approved", "planned"].includes(trip.status) ? 1 : 0;
        departmentRow.pending += ["pending", "manager_approved", "director_approved", "coordinator_review", "deputy_review", "ceo_review", "awaiting_ceo_signature"].includes(trip.status) ? 1 : 0;
        departmentRow.days += days;
        departmentRow.estimatedCost += estimatedCost;
        departmentRow.kilometers += kilometers;
        const employeeRow = increment(employeeStats, trip.employeeId, { trips: 0, approved: 0, days: 0, estimatedCost: 0, kilometers: 0 });
        employeeRow.trips += 1;
        employeeRow.approved += ["approved", "planned"].includes(trip.status) ? 1 : 0;
        employeeRow.days += days;
        employeeRow.estimatedCost += estimatedCost;
        employeeRow.kilometers += kilometers;
        const routeName = routesById.get(trip.routeId)?.path || "Маршрут не указан";
        const routeRow = increment(routeStats, routeName, { trips: 0, kilometers: 0 });
        routeRow.trips += 1;
        routeRow.kilometers += kilometers;
        transport[trip.transportType] += 1;
        statusCounts.set(trip.status, (statusCounts.get(trip.status) || 0) + 1);
        typeCounts[trip.tripType] += 1;
        const month = trip.startDate.slice(0, 7);
        const monthRow = increment(monthCounts, month, { total: 0, planned: 0, unplanned: 0 });
        monthRow.total += 1;
        monthRow[trip.tripType] += 1;
      }

      const approvalsInPeriod = approvals.filter((approval) => tripIds.has(approval.tripId));
      const resolvedApprovals = approvalsInPeriod.filter((approval) => approval.status !== "pending");
      const averageApprovalHours = resolvedApprovals.length
        ? Math.round(resolvedApprovals.reduce((total, approval) => total + Math.max(0, (new Date(approval.updatedAt).getTime() - new Date(approval.createdAt).getTime()) / 3600000), 0) / resolvedApprovals.length * 10) / 10
        : 0;
      const approvalRanking = new Map<string, { total: number; pending: number; resolved: number; averageHoursTotal: number; averageHoursCount: number }>();
      for (const approval of approvalsInPeriod) {
        const row = increment(approvalRanking, approval.approverId, { total: 0, pending: 0, resolved: 0, averageHoursTotal: 0, averageHoursCount: 0 });
        row.total += 1;
        if (approval.status === "pending") row.pending += 1;
        else {
          row.resolved += 1;
          row.averageHoursTotal += Math.max(0, (new Date(approval.updatedAt).getTime() - new Date(approval.createdAt).getTime()) / 3600000);
          row.averageHoursCount += 1;
        }
      }

      const withinPeriod = (value: Date) => {
        const day = new Date(value).toISOString().slice(0, 10);
        return day >= from && day <= to;
      };
      const chatsInPeriod = chatMessages.filter((message) => withinPeriod(message.createdAt));
      const contactsInPeriod = contactMessages.filter((message) => withinPeriod(message.createdAt));
      const chatRanking = new Map<string, { sent: number; received: number; unread: number }>();
      const chatDepartmentStats = new Map<string, number>();
      for (const message of chatsInPeriod) {
        const sender = usersById.get(message.fromUserId);
        const recipient = usersById.get(message.toUserId);
        increment(chatRanking, message.fromUserId, { sent: 0, received: 0, unread: 0 }).sent += 1;
        const recipientRow = increment(chatRanking, message.toUserId, { sent: 0, received: 0, unread: 0 });
        recipientRow.received += 1;
        if (message.isRead === "false") recipientRow.unread += 1;
        const department = sender?.department || recipient?.department || "Без отдела";
        chatDepartmentStats.set(department, (chatDepartmentStats.get(department) || 0) + 1);
      }

      const mapToSorted = <T extends { trips?: number; sent?: number }>(entries: Array<[string, T]>, key: keyof T) => entries.sort((a, b) => Number(b[1][key] || 0) - Number(a[1][key] || 0));
      const totalDays = tripsInPeriod.reduce((total, trip) => total + tripDays(trip), 0);
      const totalEstimatedCost = tripsInPeriod.reduce((total, trip) => total + allowanceDays(trip) * allowancePerNight, 0);
      const totalKilometers = tripsInPeriod.reduce((total, trip) => total + tripKilometers(trip), 0);

      res.json({
        period: { from, to },
        summary: {
          trips: tripsInPeriod.length,
          approved: tripsInPeriod.filter((trip) => ["approved", "planned"].includes(trip.status)).length,
          pending: tripsInPeriod.filter((trip) => ["pending", "manager_approved", "director_approved", "coordinator_review", "deputy_review", "ceo_review", "awaiting_ceo_signature"].includes(trip.status)).length,
          totalDays,
          totalEstimatedCost,
          totalKilometers,
          chatMessages: chatsInPeriod.length,
          unreadChatMessages: chatsInPeriod.filter((message) => message.isRead === "false").length,
          contactMessages: contactsInPeriod.length,
          averageApprovalHours,
          allowancePerNight,
        },
        tripTypes: typeCounts,
        transport,
        statuses: Array.from(statusCounts, ([status, count]) => ({ status, count })),
        monthly: Array.from(monthCounts, ([month, values]) => ({ month, ...values })).sort((a, b) => a.month.localeCompare(b.month)),
        departments: mapToSorted(Array.from(departmentStats), "trips").map(([department, values]) => ({ department, ...values })),
        employees: mapToSorted(Array.from(employeeStats), "trips").slice(0, 10).map(([employeeId, values]) => ({
          employee: usersById.get(employeeId)?.fullName || "Неизвестный сотрудник", department: usersById.get(employeeId)?.department || "Без отдела", ...values,
        })),
        routes: mapToSorted(Array.from(routeStats), "trips").slice(0, 10).map(([route, values]) => ({ route, ...values })),
        approvals: {
          total: approvalsInPeriod.length,
          pending: approvalsInPeriod.filter((approval) => approval.status === "pending").length,
          resolved: resolvedApprovals.length,
          ranking: Array.from(approvalRanking).map(([approverId, values]) => ({
            approver: usersById.get(approverId)?.fullName || "Неизвестный пользователь",
            total: values.total,
            pending: values.pending,
            resolved: values.resolved,
            averageHours: values.averageHoursCount ? Math.round(values.averageHoursTotal / values.averageHoursCount * 10) / 10 : 0,
          })).sort((a, b) => b.total - a.total).slice(0, 10),
        },
        chat: {
          total: chatsInPeriod.length,
          unread: chatsInPeriod.filter((message) => message.isRead === "false").length,
          departmentActivity: Array.from(chatDepartmentStats, ([department, messages]) => ({ department, messages })).sort((a, b) => b.messages - a.messages),
          ranking: Array.from(chatRanking).map(([userId, values]) => ({
            user: usersById.get(userId)?.fullName || "Неизвестный пользователь", department: usersById.get(userId)?.department || "Без отдела", ...values,
          })).sort((a, b) => b.sent - a.sent).slice(0, 10),
        },
      });
    } catch (error: any) {
      console.error("[ANALYTICS] Failed to build analytics", error);
      res.status(500).json({ error: "Не удалось сформировать аналитику" });
    }
  });

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

      const canGenerate = currentUser.role === "admin" || currentUser.role === "coordinator" || currentUser.id === trip.employeeId || currentUser.id === trip.employee.managerId;
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
      const requestedTimeZone = typeof req.body?.senderTimeZone === "string"
        ? req.body.senderTimeZone.trim()
        : undefined;
      let senderTimeZone: string | undefined;
      if (requestedTimeZone && requestedTimeZone.length <= 100) {
        try {
          Intl.DateTimeFormat(undefined, { timeZone: requestedTimeZone });
          senderTimeZone = requestedTimeZone;
        } catch {
          // Ignore an invalid browser time zone and retain the server timestamp.
        }
      }
      const requestedClientSentAt = typeof req.body?.clientSentAt === "string"
        ? new Date(req.body.clientSentAt)
        : undefined;
      const clientSentAt = requestedClientSentAt && !Number.isNaN(requestedClientSentAt.getTime())
        ? requestedClientSentAt
        : undefined;

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
        senderTimeZone,
        clientSentAt,
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

  app.get("/api/users/send-credentials/status", requireAdmin, async (_req, res) => {
    try {
      if (credentialBroadcast.status === "running") {
        return res.json(credentialBroadcast);
      }

      const lastBroadcast = await getLastCredentialBroadcast();
      if (lastBroadcast.status === "running") {
        // A previous server instance was restarted before it finished the queue.
        await db.execute(sql`
          UPDATE trip_planner_credential_broadcasts
          SET status = 'interrupted', completed_at = now()
          WHERE status = 'running'
        `);
        return res.json({
          ...lastBroadcast,
          status: "interrupted" as const,
          completedAt: new Date().toISOString(),
        });
      }

      return res.json(lastBroadcast);
    } catch (error: any) {
      return res.status(500).json({ error: error.message || "Failed to read credential broadcast status" });
    }
  });

  // Send credentials to all users (admin only). The work continues after the
  // response so a long, rate-limited campaign cannot outlive its HTTP request.
  app.post("/api/users/send-credentials", requireAdmin, async (req, res) => {
    try {
      if (credentialBroadcast.status === "running") {
        return res.status(409).json({ error: "Рассылка уже выполняется" });
      }

      const allUsers = await storage.getAllUsers();
      const nonAdminUsers = allUsers.filter(u => u.role !== "admin");

      if (nonAdminUsers.length === 0) {
        return res.status(400).json({ error: "No users to send credentials to" });
      }

      await ensureCredentialBroadcastTable();
      credentialBroadcastId = randomUUID();
      credentialBroadcast = {
        status: "running",
        total: nonAdminUsers.length,
        sent: 0,
        failed: 0,
        startedAt: new Date().toISOString(),
      };
      await db.execute(sql`
        INSERT INTO trip_planner_credential_broadcasts (id, status, total, sent, failed, started_at)
        VALUES (
          ${credentialBroadcastId},
          ${credentialBroadcast.status},
          ${credentialBroadcast.total},
          ${credentialBroadcast.sent},
          ${credentialBroadcast.failed},
          ${credentialBroadcast.startedAt}
        )
      `);

      void runCredentialBroadcast(nonAdminUsers);

      res.status(202).json({
        success: true,
        message: "Рассылка запущена",
        progress: credentialBroadcast,
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to send credentials" });
    }
  });

  // Send access details to a newly created user. A new temporary password is used
  // so the password shown only in the administrator's browser is never emailed later.
  app.post("/api/users/:id/send-temporary-password", requireAdmin, async (req, res) => {
    try {
      const targetUser = await storage.getUser(req.params.id);
      if (!targetUser) return res.status(404).json({ error: "User not found" });

      const newPassword = generateRandomPassword(8);
      const previousPasswordHash = targetUser.password;
      const updatedUser = await storage.updateUser(targetUser.id, { password: newPassword } as any);
      if (!updatedUser) return res.status(404).json({ error: "User not found while updating the password" });

      const emailSent = await sendEmail({
        to: targetUser.email,
        subject: "Доступ к системе командировок",
        html: generateNewUserCredentialEmail(targetUser.fullName, targetUser.email, newPassword),
      });
      if (!emailSent) {
        await storage.restoreUserPasswordHash(targetUser.id, previousPasswordHash);
        return res.status(502).json({ error: "Письмо не было принято почтовым сервером. Прежний пароль сохранен." });
      }

      res.json({ success: true, email: targetUser.email });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to send temporary password" });
    }
  });

  // Administrator can set a password manually when a user needs immediate access.
  app.patch("/api/users/:id/password", requireAdmin, async (req, res) => {
    try {
      const password = typeof req.body?.password === "string" ? req.body.password : "";
      const validation = validatePassword(password);
      if (!validation.valid) return res.status(400).json({ error: validation.errors.join(". ") });

      const updatedUser = await storage.updateUser(req.params.id, { password } as any);
      if (!updatedUser) return res.status(404).json({ error: "User not found" });
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to update password" });
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

