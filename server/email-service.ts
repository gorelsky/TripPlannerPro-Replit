/**
 * Email service for sending credentials and notifications
 * Supports both mock mode (console) and real SMTP (via env variables).
 */
import nodemailer from "nodemailer";

interface EmailOptions {
  to: string;
  subject: string;
  html: string;
}

export async function sendEmail(options: EmailOptions): Promise<boolean> {
  // In development or when no SMTP is configured, log to console.
  if (!process.env.SMTP_HOST) {
    if (process.env.NODE_ENV === "production") {
      console.error("[EMAIL] SMTP_HOST is not configured in production; email was not sent", {
        to: options.to,
        subject: options.subject,
      });
      return false;
    }
    console.log("[EMAIL] Mock email service:");
    console.log(`To: ${options.to}`);
    console.log(`Subject: ${options.subject}`);
    console.log(`Body:\n${options.html}`);
    console.log("---");
    return true;
  }

  try {
    const configuredPort = Number(process.env.SMTP_PORT || 587);
    // Some hosting networks block port 465. Yandex also supports STARTTLS on 587.
    const ports = configuredPort === 465 ? [465, 587] : [configuredPort];

    for (const port of ports) {
      const transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port,
        secure: port === 465,
        connectionTimeout: 15_000,
        greetingTimeout: 15_000,
        socketTimeout: 30_000,
        auth: process.env.SMTP_USER
          ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD }
          : undefined,
      });

      try {
        await transporter.sendMail({
          from: process.env.SMTP_FROM || process.env.SMTP_USER,
          to: options.to,
          subject: options.subject,
          html: options.html,
        });
        console.log(`[EMAIL] Sent email to ${options.to}`);
        return true;
      } catch (error) {
        console.warn(`[EMAIL] SMTP delivery failed on port ${port} for ${options.to}`, error);
      }
    }
    console.error(`[EMAIL] Failed to send email to ${options.to} on all configured SMTP ports`);
    return false;
  } catch (error) {
    console.error(`[EMAIL] Failed to prepare email for ${options.to}`, error);
    return false;
  }

  return false;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "'": "&#39;",
    "\"": "&quot;",
  })[character] || character);
}

export function generateChatNotificationEmail(recipientName: string, senderName: string): string {
  const appUrl = process.env.APP_URL || "/";
  const chatUrl = `${appUrl.replace(/\/$/, "")}/chat`;
  return `
    <html>
      <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
        <div style="max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #ddd; border-radius: 5px;">
          <h2>Новое сообщение в чате</h2>
          <p>Здравствуйте, ${escapeHtml(recipientName)}!</p>
          <p>Вам написал(а) <strong>${escapeHtml(senderName)}</strong> в системе планирования командировок.</p>
          <p style="margin: 24px 0;">
            <a href="${chatUrl}" style="display: inline-block; padding: 10px 16px; color: #fff; background: #1e40af; border-radius: 4px; text-decoration: none;">Открыть чат</a>
          </p>
          <p style="color: #666; font-size: 14px;">Текст сообщения в письме не отображается для сохранения конфиденциальности.</p>
          <hr style="border: none; border-top: 1px solid #ddd; margin: 20px 0;">
          <p style="color: #999; font-size: 12px;">Это автоматическое уведомление. Пожалуйста, не отвечайте на него напрямую.</p>
        </div>
      </body>
    </html>
  `;
}

export function generateCredentialEmail(fullName: string, email: string, password: string): string {
  const appUrl = process.env.APP_URL || "https://bba24tqeknn5rjnjom8k.containers.yandexcloud.net/";
  return `
    <html>
      <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
        <div style="max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #ddd; border-radius: 5px;">
          <h2>Приложения для командировок: доступ к системе</h2>
          <p>Добрый день, ${escapeHtml(fullName)}!</p>
          <p>С 01 декабря 2026 года запускается финальная версия приложения для планирования и согласования командировок.</p>
          <p>Прошлая версия приложения работала на сервере, который требовал подключения VPN. Сейчас хранение данных и работа приложения перенесены на платформу Яндекс Cloud, предполагается более стабильная работа без VPN.</p>
          <p>Сейчас до 01.12.2026 предусмотрен период тестирования для пользователей, которые еще не успели ознакомиться с приложением. Тестирование продлится до 30.11.2026 включительно. В этот период можно ознакомиться с созданием плановых и внеплановых командировок, согласованием, календарем, чатом, Trivio и служебными записками.</p>
          <p>Направляйте рациональные предложения по удобству работы и оптимизации через «Мой профиль» → «Связь с администратором» либо на <a href="mailto:admin.tripplanner@sls-pharma.ru">admin.tripplanner@sls-pharma.ru</a> до 01.12.2026.</p>
          <p>После завершения тестирования все тестовые командировки, согласования и сообщения будут очищены. С 01 декабря 2026 года все новые командировки необходимо будет оформлять через приложение.</p>
          <p><strong>Ваши данные для входа:</strong></p>
          <div style="background-color: #f5f5f5; padding: 15px; border-radius: 5px; margin: 20px 0;">
            <p><strong>Email (логин):</strong> <code style="background: white; padding: 5px 10px; border-radius: 3px;">${escapeHtml(email)}</code></p>
            <p><strong>Временный пароль:</strong> <code style="background: white; padding: 5px 10px; border-radius: 3px;">${escapeHtml(password)}</code></p>
          </div>
          <p><strong>Важно:</strong> после первого входа смените временный пароль в разделе «Мой профиль» → «Пароль».</p>
          <p style="margin: 24px 0;"><a href="${escapeHtml(appUrl)}" style="display: inline-block; padding: 10px 16px; color: #fff; background: #1e40af; border-radius: 4px; text-decoration: none;">Перейти в приложение</a></p>
          <p>Инструкция по работе доступна в приложении в разделе «Инструкция».</p>
          <p>С уважением,<br>Администратор приложения</p>
          <hr style="border: none; border-top: 1px solid #ddd; margin: 20px 0;">
          <p style="color: #999; font-size: 12px;">Это автоматическое письмо. Пожалуйста, не отвечайте на него напрямую.</p>
        </div>
      </body>
    </html>
  `;
}
export function generateNewUserCredentialEmail(fullName: string, email: string, password: string): string {
  const appUrl = process.env.APP_URL || "/";
  return `
    <html>
      <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
        <div style="max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #ddd; border-radius: 5px;">
          <h2>Доступ к системе командировок</h2>
          <p>Добрый день, ${escapeHtml(fullName)}!</p>
          <p>Для вас создана учетная запись в системе планирования и согласования командировок.</p>
          <div style="background-color: #f5f5f5; padding: 15px; border-radius: 5px; margin: 20px 0;">
            <p><strong>Email (логин):</strong> <code style="background: white; padding: 5px 10px; border-radius: 3px;">${escapeHtml(email)}</code></p>
            <p><strong>Временный пароль:</strong> <code style="background: white; padding: 5px 10px; border-radius: 3px;">${escapeHtml(password)}</code></p>
          </div>
          <p style="color: #666; font-size: 14px;"><strong>Важно:</strong> после первого входа смените временный пароль в разделе «Мой профиль» → «Пароль».</p>
          <p style="margin: 24px 0;"><a href="${escapeHtml(appUrl)}" style="display: inline-block; padding: 10px 16px; color: #fff; background: #1e40af; border-radius: 4px; text-decoration: none;">Перейти в приложение</a></p>
          <p>С уважением,<br>Администратор приложения</p>
        </div>
      </body>
    </html>
  `;
}

export function generatePasswordResetEmail(fullName: string, email: string, password: string): string {
  const appUrl = process.env.APP_URL || "/";
  return `
    <html>
      <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
        <div style="max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #ddd; border-radius: 5px;">
          <h2>Восстановление доступа к системе командировок</h2>
          <p>Здравствуйте, ${escapeHtml(fullName)}!</p>
          <p>Администратор сформировал для вас новый временный пароль для входа в систему.</p>
          <div style="background-color: #f5f5f5; padding: 15px; border-radius: 5px; margin: 20px 0;">
            <p><strong>Email (логин):</strong> <code style="background: white; padding: 5px 10px; border-radius: 3px;">${escapeHtml(email)}</code></p>
            <p><strong>Временный пароль:</strong> <code style="background: white; padding: 5px 10px; border-radius: 3px;">${escapeHtml(password)}</code></p>
          </div>
          <p style="color: #666; font-size: 14px;"><strong>Важно:</strong> после входа смените временный пароль в разделе «Мой профиль».</p>
          <p>Ссылка на систему: <a href="${escapeHtml(appUrl)}">Перейти в систему</a></p>
          <hr style="border: none; border-top: 1px solid #ddd; margin: 20px 0;">
          <p style="color: #999; font-size: 12px;">Это автоматическое письмо. Пожалуйста, не отвечайте на него напрямую.</p>
        </div>
      </body>
    </html>
  `;
}

export function generateContactAdminEmail(userName: string, userEmail: string, subject: string, message: string): string {
  return `
    <html>
      <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
        <div style="max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #ddd; border-radius: 5px;">
          <h2>Сообщение от пользователя</h2>
          
          <p><strong>От:</strong> ${escapeHtml(userName)} (${escapeHtml(userEmail)})</p>
          <p><strong>Тема:</strong> ${escapeHtml(subject)}</p>
          
          <hr style="border: none; border-top: 1px solid #ddd; margin: 20px 0;">
          
          <p><strong>Сообщение:</strong></p>
          <div style="background-color: #f5f5f5; padding: 15px; border-radius: 5px; white-space: pre-wrap; word-wrap: break-word;">
${escapeHtml(message)}
          </div>
          
          <hr style="border: none; border-top: 1px solid #ddd; margin: 20px 0;">
          <p style="color: #999; font-size: 12px;">
            Отправлено из системы управления командировками.
          </p>
        </div>
      </body>
    </html>
  `;
}
