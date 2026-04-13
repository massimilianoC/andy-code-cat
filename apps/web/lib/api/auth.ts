import { call } from "./call";

export interface RegisterInput {
    email: string;
    password: string;
    firstName?: string;
    lastName?: string;
}
export interface RegisterResult {
    user: { id: string; email: string; firstName?: string; lastName?: string; emailVerified: boolean };
    defaultProject: { id: string; name: string };
}
export function register(input: RegisterInput) {
    return call<RegisterResult>("POST", "/v1/auth/register", input);
}

export interface LoginInput {
    email: string;
    password: string;
}
export interface LoginResult {
    user: { id: string; email: string; roles: string[] };
    projects: { id: string; name: string }[];
    activeProjectId: string;
    emailVerificationRequired: boolean;
    requiresPasswordChange: boolean;
    accessToken: string;
    refreshToken: string;
}
export function login(input: LoginInput) {
    return call<LoginResult>("POST", "/v1/auth/login", input);
}

export interface RefreshResult {
    accessToken: string;
    refreshToken: string;
    activeProjectId: string;
    emailVerificationRequired: boolean;
    requiresPasswordChange: boolean;
}
export function refreshTokenManual(refreshToken: string) {
    return call<RefreshResult>("POST", "/v1/auth/refresh", { refreshToken });
}

export interface ChangePasswordInput {
    currentPassword: string;
    newPassword: string;
}

export interface ChangePasswordResult {
    reauthRequired: boolean;
    requiresPasswordChange: boolean;
}

export function changePassword(token: string, input: ChangePasswordInput) {
    return call<ChangePasswordResult>("POST", "/v1/auth/change-password", input, {
        Authorization: `Bearer ${token}`,
    });
}
