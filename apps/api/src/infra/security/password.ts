import bcrypt from "bcryptjs";

const SALT_ROUNDS = 12;

export async function hashPassword(rawPassword: string): Promise<string> {
    return bcrypt.hash(rawPassword, SALT_ROUNDS);
}

export async function verifyPassword(rawPassword: string, hash: string): Promise<boolean> {
    return bcrypt.compare(rawPassword, hash);
}
