export interface ValidationRule {
  required?: boolean;
  minLength?: number;
  maxLength?: number;
  pattern?: RegExp;
  custom?: (value: string) => string | null;
}

export interface ValidationResult {
  valid: boolean;
  error: string | null;
}

export function validate(value: string, rules: ValidationRule): ValidationResult {
  const trimmed = value.trim();

  if (rules.required && !trimmed) {
    return { valid: false, error: "This field is required" };
  }

  if (rules.minLength && trimmed.length < rules.minLength) {
    return { valid: false, error: `Must be at least ${rules.minLength} characters` };
  }

  if (rules.maxLength && trimmed.length > rules.maxLength) {
    return { valid: false, error: `Must be no more than ${rules.maxLength} characters` };
  }

  if (rules.pattern && !rules.pattern.test(trimmed)) {
    return { valid: false, error: "Invalid format" };
  }

  if (rules.custom) {
    const error = rules.custom(trimmed);
    if (error) return { valid: false, error };
  }

  return { valid: true, error: null };
}

export const emailRule: ValidationRule = {
  required: true,
  pattern: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
  custom: (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) ? null : "Invalid email address",
};

export const passwordRule: ValidationRule = {
  required: true,
  minLength: 8,
  custom: (v) => {
    if (!/[A-Z]/.test(v)) return "Must contain at least one uppercase letter";
    if (!/[a-z]/.test(v)) return "Must contain at least one lowercase letter";
    if (!/[0-9]/.test(v)) return "Must contain at least one number";
    return null;
  },
};

export function validatePasswordMatch(password: string, confirm: string): string | null {
  if (password !== confirm) return "Passwords do not match";
  return null;
}
