/**
 * Password generation and validation utilities
 */

export function generateRandomPassword(length: number = 8): string {
  const charset = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%";
  let password = "";
  for (let i = 0; i < length; i++) {
    password += charset.charAt(Math.floor(Math.random() * charset.length));
  }
  return password;
}

export function validatePassword(password: string): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  
  if (password.length < 8) {
    errors.push("Пароль должен содержать минимум 8 символов");
  }
  
  if (!/[a-z]/.test(password)) {
    errors.push("Пароль должен содержать строчные буквы");
  }
  
  if (!/[A-Z]/.test(password)) {
    errors.push("Пароль должен содержать прописные буквы");
  }
  
  if (!/[0-9]/.test(password)) {
    errors.push("Пароль должен содержать цифры");
  }
  
  return {
    valid: errors.length === 0,
    errors,
  };
}
