import jwt from "jsonwebtoken";
import { env } from "../../config";

const accessTokenTtl = env.JWT_ACCESS_TTL as jwt.SignOptions["expiresIn"];
const refreshTokenTtl = env.JWT_REFRESH_TTL as jwt.SignOptions["expiresIn"];

function throwUnauthorizedTokenError(error: unknown, userMessage: string): never {
    const normalizedError = new Error(userMessage) as Error & {
        statusCode?: number;
        code?: string;
        userMessage?: string;
        details?: unknown;
    };

    normalizedError.statusCode = 401;
    normalizedError.userMessage = userMessage;

    if (error instanceof Error && error.name === "TokenExpiredError") {
        normalizedError.code = "TOKEN_EXPIRED";
    } else {
        normalizedError.code = "INVALID_TOKEN";
    }

    normalizedError.details = error instanceof Error
        ? { name: error.name, message: error.message }
        : undefined;

    throw normalizedError;
}

export interface AccessTokenPayload {
    sub: string;
    roles: string[];
    sid?: string;
    exp?: number;
    iat?: number;
}

export interface RefreshTokenPayload {
    sub: string;
    sid?: string;
    exp?: number;
    iat?: number;
}

export function signAccessToken(payload: AccessTokenPayload): string {
    return jwt.sign(payload, env.JWT_ACCESS_SECRET, { expiresIn: accessTokenTtl });
}

export function signRefreshToken(payload: RefreshTokenPayload): string {
    return jwt.sign(payload, env.JWT_REFRESH_SECRET, { expiresIn: refreshTokenTtl });
}

export function verifyAccessToken(token: string): AccessTokenPayload {
    try {
        return jwt.verify(token, env.JWT_ACCESS_SECRET) as AccessTokenPayload;
    } catch (error) {
        return throwUnauthorizedTokenError(error, "Invalid access token");
    }
}

export function verifyRefreshToken(token: string): RefreshTokenPayload {
    try {
        return jwt.verify(token, env.JWT_REFRESH_SECRET) as RefreshTokenPayload;
    } catch (error) {
        return throwUnauthorizedTokenError(error, "Invalid refresh token");
    }
}
