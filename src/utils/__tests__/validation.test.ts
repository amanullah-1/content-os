import { describe, it, expect } from "vitest";
import {
  validate,
  emailRule,
  passwordRule,
  validatePasswordMatch,
  type ValidationRule,
} from "../validation";

describe("validate", () => {
  it("returns valid for empty value with no rules", () => {
    expect(validate("", {})).toEqual({ valid: true, error: null });
  });

  it("fails required rule when empty", () => {
    const result = validate("", { required: true });
    expect(result.valid).toBe(false);
    expect(result.error).toBe("This field is required");
  });

  it("passes required rule when non-empty", () => {
    expect(validate("hello", { required: true })).toEqual({ valid: true, error: null });
  });

  it("trims whitespace before checking required", () => {
    expect(validate("   ", { required: true })).toEqual({ valid: false, error: "This field is required" });
  });

  it("fails minLength rule", () => {
    const result = validate("ab", { minLength: 3 });
    expect(result.valid).toBe(false);
    expect(result.error).toBe("Must be at least 3 characters");
  });

  it("passes minLength rule", () => {
    expect(validate("abc", { minLength: 3 })).toEqual({ valid: true, error: null });
  });

  it("fails maxLength rule", () => {
    const result = validate("abcd", { maxLength: 3 });
    expect(result.valid).toBe(false);
    expect(result.error).toBe("Must be no more than 3 characters");
  });

  it("passes maxLength rule", () => {
    expect(validate("abc", { maxLength: 3 })).toEqual({ valid: true, error: null });
  });

  it("fails pattern rule", () => {
    const rule: ValidationRule = { pattern: /^\d+$/ };
    expect(validate("abc", rule).valid).toBe(false);
  });

  it("passes pattern rule", () => {
    const rule: ValidationRule = { pattern: /^\d+$/ };
    expect(validate("123", rule)).toEqual({ valid: true, error: null });
  });

  it("fails custom rule", () => {
    const rule: ValidationRule = { custom: (v) => (v === "bad" ? "Nope" : null) };
    expect(validate("bad", rule)).toEqual({ valid: false, error: "Nope" });
  });

  it("passes custom rule", () => {
    const rule: ValidationRule = { custom: (v) => (v === "bad" ? "Nope" : null) };
    expect(validate("good", rule)).toEqual({ valid: true, error: null });
  });

  it("checks rules in order: required first", () => {
    const rule: ValidationRule = { required: true, minLength: 5 };
    const result = validate("", rule);
    expect(result.error).toBe("This field is required");
  });

  it("checks rules in order: minLength after required", () => {
    const rule: ValidationRule = { required: true, minLength: 5 };
    const result = validate("ab", rule);
    expect(result.error).toBe("Must be at least 5 characters");
  });
});

describe("emailRule", () => {
  it("rejects empty email", () => {
    expect(validate("", emailRule).valid).toBe(false);
  });

  it("rejects invalid email", () => {
    expect(validate("notanemail", emailRule).valid).toBe(false);
    expect(validate("foo@", emailRule).valid).toBe(false);
    expect(validate("@bar.com", emailRule).valid).toBe(false);
  });

  it("accepts valid email", () => {
    expect(validate("user@example.com", emailRule).valid).toBe(true);
    expect(validate("test+tag@domain.co", emailRule).valid).toBe(true);
  });
});

describe("passwordRule", () => {
  it("rejects empty password", () => {
    expect(validate("", passwordRule).valid).toBe(false);
  });

  it("rejects short password", () => {
    expect(validate("Ab1", passwordRule).valid).toBe(false);
  });

  it("rejects password without uppercase", () => {
    const result = validate("alllower1", passwordRule);
    expect(result.valid).toBe(false);
    expect(result.error).toContain("uppercase");
  });

  it("rejects password without lowercase", () => {
    const result = validate("ALLUPPER1", passwordRule);
    expect(result.valid).toBe(false);
    expect(result.error).toContain("lowercase");
  });

  it("rejects password without number", () => {
    const result = validate("NoNumbers", passwordRule);
    expect(result.valid).toBe(false);
    expect(result.error).toContain("number");
  });

  it("accepts valid password", () => {
    expect(validate("ValidPass1", passwordRule).valid).toBe(true);
  });
});

describe("validatePasswordMatch", () => {
  it("returns null when passwords match", () => {
    expect(validatePasswordMatch("abc", "abc")).toBeNull();
  });

  it("returns error when passwords differ", () => {
    expect(validatePasswordMatch("abc", "xyz")).toBe("Passwords do not match");
  });
});
