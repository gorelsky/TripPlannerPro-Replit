import assert from "node:assert/strict";
import test from "node:test";
import nodemailer from "nodemailer";
import {
  generateApprovalNotificationEmail,
  generateChatNotificationEmail,
  sendEmailDetailed,
  type EmailDeliveryResult,
} from "../email-service";
import {
  createPendingApprovalAndNotify,
  deliverEmailNotification,
  type EmailNotificationContext,
  type EmailNotificationDispatcher,
  type NotificationDeliveryDependencies,
} from "../notification-delivery";
import type { Approval, InsertApproval, TripWithDetails, User } from "@shared/schema";
import type { IStorage } from "../storage";

const fakeApprover = {
  id: "approver-test-1",
  fullName: "Мария Тестова",
  email: "approver@example.test",
} as User;

const fakeTrip = {
  id: "trip-test-1",
  startDate: "2026-12-03",
  endDate: "2026-12-05",
  tripType: "planned",
  employee: { fullName: "Иван Тестовый" },
  city: { name: "Казань" },
  route: { cities: ["Москва", "Казань"] },
} as unknown as TripWithDetails;

function createFakeStorage() {
  const createdApprovals: InsertApproval[] = [];
  const approval: Approval = {
    id: "approval-test-1",
    tripId: fakeTrip.id,
    approverId: fakeApprover.id,
    status: "pending",
    comment: null,
    createdAt: new Date("2026-11-19T00:00:00.000Z"),
    updatedAt: new Date("2026-11-19T00:00:00.000Z"),
  };
  const storage = {
    createApproval: async (input: InsertApproval) => {
      createdApprovals.push(input);
      return approval;
    },
    getTripWithDetails: async (tripId: string) => tripId === fakeTrip.id ? fakeTrip : undefined,
    getUser: async (userId: string) => userId === fakeApprover.id ? fakeApprover : undefined,
  } as unknown as Pick<IStorage, "createApproval" | "getTripWithDetails" | "getUser">;

  return { storage, approval, createdApprovals };
}

function createTestLogger() {
  const entries: Array<{ level: string; message: string }> = [];
  const logger = {
    info: (message: string) => entries.push({ level: "info", message }),
    warn: (message: string) => entries.push({ level: "warn", message }),
    error: (message: string) => entries.push({ level: "error", message }),
  } as Pick<Console, "info" | "warn" | "error">;
  return { entries, logger };
}

function parseNotificationLog(message: string) {
  const json = message.slice("[EMAIL_NOTIFICATION] ".length);
  return JSON.parse(json) as Record<string, unknown>;
}

async function withEnvironment<T>(values: Record<string, string | undefined>, callback: () => Promise<T> | T): Promise<T> {
  const previous = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(values)) {
    previous.set(key, process.env[key]);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }

  try {
    return await callback();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

function emailLink(html: string): URL {
  const href = html.match(/href="([^"]+)"/)?.[1];
  assert.ok(href, "email template should contain a link");
  return new URL(href);
}

test("chat and approval email links are absolute and respect each deployment base URL", async () => {
  await withEnvironment({ APP_URL: "https://trip.sls-planner.ru/" }, () => {
    assert.equal(emailLink(generateChatNotificationEmail("Получатель", "Отправитель")).href, "https://trip.sls-planner.ru/chat");
    assert.equal(emailLink(generateApprovalNotificationEmail("Согласующий", "Сотрудник", "2026-12-03", "2026-12-05", "Казань", "planned")).href, "https://trip.sls-planner.ru/approvals");
  });

  await withEnvironment({ APP_URL: "https://tripplanner-production.up.railway.app/app/" }, () => {
    assert.equal(emailLink(generateChatNotificationEmail("Recipient", "Sender")).href, "https://tripplanner-production.up.railway.app/app/chat");
    assert.equal(emailLink(generateApprovalNotificationEmail("Approver", "Employee", "2026-12-03", "2026-12-05", "Kazan", "planned")).href, "https://tripplanner-production.up.railway.app/app/approvals");
  });
});

test("missing or invalid APP_URL fails explicitly instead of generating relative or unsafe links", async () => {
  await withEnvironment({ APP_URL: undefined }, () => {
    assert.throws(() => generateChatNotificationEmail("Получатель", "Отправитель"), /APP_URL is required/);
    assert.throws(() => generateApprovalNotificationEmail("Согласующий", "Сотрудник", "2026-12-03", "2026-12-05", "Казань", "planned"), /APP_URL is required/);
  });

  await withEnvironment({ APP_URL: "javascript:alert(1)" }, () => {
    assert.throws(() => generateChatNotificationEmail("Получатель", "Отправитель"), /absolute HTTP or HTTPS URL/);
  });
});

test("SMTP 465 failure falls back to STARTTLS on 587 and reports the accepted result", async () => {
  await withEnvironment({ SMTP_HOST: "smtp.example.test", SMTP_PORT: "465", SMTP_USER: "sender@example.test", SMTP_PASSWORD: "fake-password", SMTP_FROM: "sender@example.test", NODE_ENV: "production" }, async () => {
    const ports: number[] = [];
    const fakeTransportFactory = ((configuration: { port: number }) => {
      ports.push(configuration.port);
      return {
        sendMail: async () => {
          if (configuration.port === 465) throw Object.assign(new Error("connection reset"), { code: "ECONNRESET" });
          return { messageId: "synthetic-message-id" };
        },
      };
    }) as unknown as typeof nodemailer.createTransport;

    const result = await sendEmailDetailed({
      to: fakeApprover.email,
      subject: "Synthetic approval notification",
      html: "<p>Test only</p>",
    }, fakeTransportFactory);

    assert.deepEqual(ports, [465, 587]);
    assert.deepEqual(result, { sent: true, retryable: false });
  });
});

test("a transient SMTP failure is retried and the final result is diagnosed", async () => {
  await withEnvironment({ SMTP_HOST: "smtp.example.test", SMTP_PORT: "587", SMTP_USER: "sender@example.test", SMTP_PASSWORD: "fake-password", SMTP_FROM: "sender@example.test", NODE_ENV: "production", APP_URL: "https://trip.sls-planner.ru" }, async () => {
    let smtpAttempts = 0;
    const fakeTransportFactory = ((_configuration: unknown) => ({
      sendMail: async () => {
        smtpAttempts += 1;
        if (smtpAttempts === 1) throw Object.assign(new Error("temporary connection failure"), { code: "ECONNRESET" });
        return { messageId: "synthetic-message-id" };
      },
    })) as unknown as typeof nodemailer.createTransport;
    const { entries, logger } = createTestLogger();
    const dependencies: NotificationDeliveryDependencies = {
      sendEmail: (options) => sendEmailDetailed(options, fakeTransportFactory),
      wait: async () => undefined,
      retryDelaysMs: [0],
      logger,
    };

    await deliverEmailNotification(
      { type: "approval", approvalId: "approval-test-1", tripId: fakeTrip.id },
      async () => ({
        to: fakeApprover.email,
        subject: "Synthetic approval notification",
        html: generateApprovalNotificationEmail(fakeApprover.fullName, "Иван Тестовый", fakeTrip.startDate, fakeTrip.endDate, "Казань", "planned"),
      }),
      dependencies,
    );

    assert.equal(smtpAttempts, 2);
    const statuses = entries.map(({ message }) => parseNotificationLog(message).status);
    assert.deepEqual(statuses, ["retrying", "sent"]);
    assert.ok(entries.every(({ message }) => message.includes('"approvalId":"approval-test-1"')));
  });
});

test("a missing production SMTP host is reported without blocking the pending approval", async () => {
  await withEnvironment({ APP_URL: "https://trip.sls-planner.ru", SMTP_HOST: undefined, NODE_ENV: "production" }, async () => {
    const { storage, approval, createdApprovals } = createFakeStorage();
    const { entries, logger } = createTestLogger();
    let delivery: Promise<void> | undefined;
    const dispatcher: EmailNotificationDispatcher = (context, prepareEmail) => {
      delivery = deliverEmailNotification(context, prepareEmail, {
        logger,
        sendEmail: (email) => sendEmailDetailed(email, (() => {
          throw new Error("SMTP transport must not be created when SMTP_HOST is missing");
        }) as unknown as typeof nodemailer.createTransport),
      });
      return delivery;
    };

    const created = await createPendingApprovalAndNotify(storage, fakeTrip.id, fakeApprover.id, dispatcher);
    await delivery;

    assert.equal(created.id, approval.id);
    assert.equal(createdApprovals.length, 1);
    assert.equal(createdApprovals[0].status, "pending");
    const failure = entries.map(({ message }) => parseNotificationLog(message)).find((entry) => entry.status === "failed");
    assert.equal(failure?.approvalId, approval.id);
    assert.equal(failure?.tripId, fakeTrip.id);
    assert.match(String(failure?.error), /SMTP_HOST is not configured in production/);
  });
});

test("creating an approval returns while SMTP is still pending", async () => {
  await withEnvironment({ APP_URL: "https://trip.sls-planner.ru" }, async () => {
    const { storage, approval, createdApprovals } = createFakeStorage();
    const { logger } = createTestLogger();
    let releaseSmtp!: (result: EmailDeliveryResult) => void;
    let markSmtpStarted!: () => void;
    const smtpStarted = new Promise<void>((resolve) => { markSmtpStarted = resolve; });
    let generatedEmailTo: string | undefined;
    let delivery: Promise<void> | undefined;

    const dispatcher: EmailNotificationDispatcher = (context, prepareEmail) => {
      delivery = deliverEmailNotification(context, prepareEmail, {
        logger,
        retryDelaysMs: [],
        sendEmail: async (email) => {
          generatedEmailTo = email.to;
          markSmtpStarted();
          return new Promise<EmailDeliveryResult>((resolve) => { releaseSmtp = resolve; });
        },
      });
      return delivery;
    };

    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      const created = await Promise.race([
        createPendingApprovalAndNotify(storage, fakeTrip.id, fakeApprover.id, dispatcher),
        new Promise<never>((_, reject) => { timeout = setTimeout(() => reject(new Error("approval creation waited for SMTP")), 500); }),
      ]);
      assert.equal(created.id, approval.id);
      assert.equal(createdApprovals.length, 1);
      assert.equal(createdApprovals[0].status, "pending");
      await smtpStarted;
      assert.equal(generatedEmailTo, fakeApprover.email);
    } finally {
      if (timeout) clearTimeout(timeout);
      releaseSmtp?.({ sent: false, retryable: false, error: "synthetic SMTP rejection" });
      await delivery;
    }
  });
});

test("missing APP_URL is logged with approval and trip IDs without undoing approval creation", async () => {
  await withEnvironment({ APP_URL: undefined }, async () => {
    const { storage, approval, createdApprovals } = createFakeStorage();
    const { entries, logger } = createTestLogger();
    let delivery: Promise<void> | undefined;
    const dispatcher: EmailNotificationDispatcher = (context, prepareEmail) => {
      delivery = deliverEmailNotification(context, prepareEmail, {
        logger,
        sendEmail: async () => { throw new Error("SMTP should not start without a link"); },
      });
      return delivery;
    };

    const created = await createPendingApprovalAndNotify(storage, fakeTrip.id, fakeApprover.id, dispatcher);
    await delivery;

    assert.equal(created.id, approval.id);
    assert.equal(createdApprovals.length, 1);
    assert.equal(createdApprovals[0].status, "pending");
    const failure = entries.map(({ message }) => parseNotificationLog(message)).find((entry) => entry.status === "failed");
    assert.equal(failure?.approvalId, approval.id);
    assert.equal(failure?.tripId, fakeTrip.id);
    assert.match(String(failure?.error), /APP_URL is required/);
  });
});

test("missing APP_URL for a chat notification is captured by the background delivery path", async () => {
  await withEnvironment({ APP_URL: undefined }, async () => {
    const { entries, logger } = createTestLogger();
    const context: EmailNotificationContext = { type: "chat", chatMessageId: "chat-message-test-1" };

    await deliverEmailNotification(
      context,
      async () => ({
        to: "recipient@example.test",
        subject: "Synthetic chat notification",
        html: generateChatNotificationEmail("Получатель", "Отправитель"),
      }),
      { logger, sendEmail: async () => ({ sent: true, retryable: false }) },
    );

    const failure = entries.map(({ message }) => parseNotificationLog(message)).find((entry) => entry.status === "failed");
    assert.equal(failure?.chatMessageId, context.chatMessageId);
    assert.match(String(failure?.error), /APP_URL is required/);
  });
});
