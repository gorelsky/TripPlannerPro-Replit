import type { Approval, InsertApproval } from "@shared/schema";
import {
  generateApprovalNotificationEmail,
  sendEmailDetailed,
  type EmailDeliveryResult,
  type EmailOptions,
} from "./email-service";
import type { IStorage } from "./storage";

export type EmailNotificationContext =
  | { type: "approval"; approvalId: string; tripId: string }
  | { type: "chat"; chatMessageId: string };

export type EmailNotificationDispatcher = (
  context: EmailNotificationContext,
  prepareEmail: () => Promise<EmailOptions>,
) => void | Promise<void>;

export type NotificationDeliveryDependencies = {
  sendEmail?: (options: EmailOptions) => Promise<EmailDeliveryResult>;
  wait?: (milliseconds: number) => Promise<void>;
  retryDelaysMs?: number[];
  logger?: Pick<Console, "info" | "warn" | "error">;
};

const defaultRetryDelaysMs = [10_000, 20_000];
const wait = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function logNotification(
  logger: Pick<Console, "info" | "warn" | "error">,
  level: "info" | "warn" | "error",
  context: EmailNotificationContext,
  status: "sent" | "retrying" | "failed",
  details: Record<string, unknown> = {},
) {
  logger[level](`[EMAIL_NOTIFICATION] ${JSON.stringify({ event: "email_notification", ...context, status, ...details })}`);
}

export async function deliverEmailNotification(
  context: EmailNotificationContext,
  prepareEmail: () => Promise<EmailOptions>,
  dependencies: NotificationDeliveryDependencies = {},
): Promise<void> {
  const logger = dependencies.logger || console;
  const sender = dependencies.sendEmail || sendEmailDetailed;
  const retryDelaysMs = dependencies.retryDelaysMs ?? defaultRetryDelaysMs;
  const delay = dependencies.wait || wait;

  let email: EmailOptions;
  try {
    email = await prepareEmail();
  } catch (error) {
    logNotification(logger, "error", context, "failed", { attempt: 0, error: errorMessage(error) });
    return;
  }

  for (let attempt = 1; attempt <= retryDelaysMs.length + 1; attempt += 1) {
    let result: EmailDeliveryResult;
    try {
      result = await sender(email);
    } catch (error) {
      result = { sent: false, retryable: false, error: errorMessage(error) };
    }

    if (result.sent) {
      logNotification(logger, "info", context, "sent", { attempt });
      return;
    }

    const error = result.error || "SMTP did not accept the message";
    if (result.retryable && attempt <= retryDelaysMs.length) {
      const retryInMs = retryDelaysMs[attempt - 1];
      logNotification(logger, "warn", context, "retrying", { attempt, retryInMs, error });
      try {
        await delay(retryInMs);
      } catch (delayError) {
        logNotification(logger, "error", context, "failed", {
          attempt,
          error: `Retry delay failed: ${errorMessage(delayError)}`,
          lastDeliveryError: error,
        });
        return;
      }
      continue;
    }

    logNotification(logger, "error", context, "failed", { attempt, retryable: result.retryable, error });
    return;
  }
}

export function dispatchEmailNotificationInBackground(
  context: EmailNotificationContext,
  prepareEmail: () => Promise<EmailOptions>,
): void {
  void deliverEmailNotification(context, prepareEmail).catch((error) => {
    logNotification(console, "error", context, "failed", { attempt: 0, error: errorMessage(error) });
  });
}

type ApprovalNotificationStorage = Pick<IStorage, "createApproval" | "getTripWithDetails" | "getUser">;

export async function createPendingApprovalAndNotify(
  storage: ApprovalNotificationStorage,
  tripId: string,
  approverId: string,
  dispatch: EmailNotificationDispatcher = dispatchEmailNotificationInBackground,
): Promise<Approval> {
  const approval: Approval = await storage.createApproval({
    tripId,
    approverId,
    status: "pending" as InsertApproval["status"],
  });

  const context: EmailNotificationContext = { type: "approval", approvalId: approval.id, tripId };
  const prepareEmail = async (): Promise<EmailOptions> => {
    const [trip, approver] = await Promise.all([
      storage.getTripWithDetails(tripId),
      storage.getUser(approverId),
    ]);
    if (!trip) throw new Error("Trip was not found while preparing approval notification");
    if (!approver?.email?.trim()) throw new Error("Approver email is missing");

    return {
      to: approver.email,
      subject: "Требуется согласование командировки - Планировщик командировок",
      html: generateApprovalNotificationEmail(
        approver.fullName,
        trip.employee.fullName,
        trip.startDate,
        trip.endDate,
        trip.city?.name || trip.route?.cities?.join(" — ") || "не указан",
        trip.tripType,
      ),
    };
  };

  try {
    void Promise.resolve(dispatch(context, prepareEmail)).catch((error) => {
      logNotification(console, "error", context, "failed", { attempt: 0, error: errorMessage(error) });
    });
  } catch (error) {
    logNotification(console, "error", context, "failed", { attempt: 0, error: errorMessage(error) });
  }

  return approval;
}
