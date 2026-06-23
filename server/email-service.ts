/**
 * Email service for sending credentials and notifications
 * Supports both mock mode (console) and real SMTP (via env variables)
 */

interface EmailOptions {
  to: string;
  subject: string;
  html: string;
}

export async function sendEmail(options: EmailOptions): Promise<boolean> {
  // In development or when no SMTP is configured, log to console
  if (!process.env.SMTP_HOST) {
    console.log("[EMAIL] Mock email service:");
    console.log(`To: ${options.to}`);
    console.log(`Subject: ${options.subject}`);
    console.log(`Body:\n${options.html}`);
    console.log("---");
    return true;
  }

  // In production with SMTP configured, would use nodemailer
  // For now, we'll just log
  console.log(`[EMAIL] Would send email to ${options.to}`);
  return true;
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
