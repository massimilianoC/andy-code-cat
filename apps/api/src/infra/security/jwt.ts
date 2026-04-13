import jwt from "jsonwebtoken";
import { env } from "../../config";

const accessTokenTtl = env.JWT_ACCESS_TTL as jwt.SignOptions["expiresIn"];
const refreshTokenTtl = env.JWT_REFRESH_TTL as jwt.SignOptions["expiresIn"];

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
    return jwt.verify(token, env.JWT_ACCESS_SECRET) as AccessTokenPayload;
}

export function verifyRefreshToken(token: string): RefreshTokenPayload {
    return jwt.verify(token, env.JWT_REFRESH_SECRET) as RefreshTokenPayload;
}
