import type { Request } from "express";

export interface AuthContext {
    userId: string;
    roles: string[];
}

export interface SandboxContext {
    projectId: string;
}

export type RequestWithContext = Request & {
    auth?: AuthContext;
    sandbox?: SandboxContext;
};
