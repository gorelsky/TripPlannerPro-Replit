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
    console.log("[EMAIL] Mock email service:");
    console.log(`To: ${options.to}`);
    console.log(`Subject: ${options.subject}`);
    console.log(`Body:\n${options.html}`);
    console.log("---");
    return true;
  }

  try {
    const port = Number(process.env.SMTP_PORT || 587);
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port,
      secure: process.env.SMTP_SECURE === "true" || port === 465,
      auth: process.env.SMTP_USER
        ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD }
        : undefined,
    });
    await transporter.sendMail({
      from: process.env.SMTP_FROM || process.env.SMTP_USER,
      to: options.to,
      subject: options.subject,
      html: options.html,
    });
    console.log(`[EMAIL] Sent email to ${options.to}`);
    return true;
  } catch (error) {
    console.error(`[EMAIL] Failed to send email to ${options.to}`, error);
    return false;
  }
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
  const appUrl = process.env.APP_URL || "http://localhost:5000";
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
  return `
    <html>
      <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
        <div style="max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #ddd; border-radius: 5px;">
          <h2>Добро пожаловать в систему управления командировками!</h2>
          
          <p>Здравствуйте, ${fullName}!</p>
          
          <p>Вы были добавлены в систему. Ниже ваши учетные данные для входа:</p>
          
          <div style="background-color: #f5f5f5; padding: 15px; border-radius: 5px; margin: 20px 0;">
            <p><strong>Email (Логин):</strong> <code style="background: white; padding: 5px 10px; border-radius: 3px;">${email}</code></p>
            <p><strong>Пароль:</strong> <code style="background: white; padding: 5px 10px; border-radius: 3px;">${password}</code></p>
          </div>
          
          <p style="color: #666; font-size: 14px;">
            <strong>Внимание:</strong> Пожалуйста, смените пароль после первого входа в систему для безопасности.
          </p>
          
          <p>Ссылка на систему: <a href="${process.env.APP_URL || 'http://localhost:5000'}">Перейти в систему</a></p>
          
          <hr style="border: none; border-top: 1px solid #ddd; margin: 20px 0;">
          <p style="color: #999; font-size: 12px;">
            Это автоматическое письмо. Пожалуйста, не отвечайте на него напрямую.
          </p>
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
          
          <p><strong>От:</strong> ${userName} (${userEmail})</p>
          <p><strong>Тема:</strong> ${subject}</p>
          
          <hr style="border: none; border-top: 1px solid #ddd; margin: 20px 0;">
          
          <p><strong>Сообщение:</strong></p>
          <div style="background-color: #f5f5f5; padding: 15px; border-radius: 5px; white-space: pre-wrap; word-wrap: break-word;">
${message}
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
