import { z } from "zod";

export const PASSWORD_MIN_LENGTH = 12;
export const CURRENT_PASSWORD_POLICY_VERSION = 2;
export const passwordPolicyDescription = "Use at least 12 characters with uppercase, lowercase, number, and symbol.";

export const strongPasswordSchema = z.string()
  .min(PASSWORD_MIN_LENGTH, `Password must be at least ${PASSWORD_MIN_LENGTH} characters long`)
  .max(128)
  .regex(/[a-z]/, "Password must include at least one lowercase letter")
  .regex(/[A-Z]/, "Password must include at least one uppercase letter")
  .regex(/[0-9]/, "Password must include at least one number")
  .regex(/[^A-Za-z0-9]/, "Password must include at least one symbol");

export const registerSchema = z.object({
  email: z.string().email(),
  password: strongPasswordSchema,
  firstName: z.string().min(1).max(80).optional(),
  lastName: z.string().min(1).max(80).optional(),
});

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(128),
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(8).max(128),
  newPassword: strongPasswordSchema,
}).refine((input) => input.currentPassword !== input.newPassword, {
  message: "New password must be different from the current password",
  path: ["newPassword"],
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
