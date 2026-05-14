import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes } from "crypto";

const ALGORITHM = "aes-256-gcm";
const KEY_LENGTH = 32; // 256 bits
const IV_LENGTH = 12;  // 96 bits recommended for GCM
const TAG_LENGTH = 16; // 128 bits

/**
 * CryptoService — AES-256-GCM symmetric encryption for service API keys.
 *
 * Master key derivation:
 *   HKDF-SHA256(ikm=JWT_ACCESS_SECRET, salt=MONGODB_DB_NAME, info="service-api-keys")
 *
 * No new env vars required — derives from existing mandatory secrets.
 */
export class CryptoService {
    private readonly masterKey: Buffer;

    constructor(jwtAccessSecret: string, dbName: string) {
        this.masterKey = Buffer.from(
            hkdfSync(
                "sha256",
                Buffer.from(jwtAccessSecret, "utf8"),
                Buffer.from(dbName, "utf8"),
                Buffer.from("service-api-keys", "utf8"),
                KEY_LENGTH,
            ),
        );
    }

    encrypt(plaintext: string): { encryptedKey: string; iv: string; authTag: string } {
        const iv = randomBytes(IV_LENGTH);
        const cipher = createCipheriv(ALGORITHM, this.masterKey, iv, { authTagLength: TAG_LENGTH });
        const encrypted = Buffer.concat([
            cipher.update(Buffer.from(plaintext, "utf8")),
            cipher.final(),
        ]);
        const authTag = cipher.getAuthTag();
        return {
            encryptedKey: encrypted.toString("base64"),
            iv: iv.toString("base64"),
            authTag: authTag.toString("base64"),
        };
    }

    decrypt(encryptedKey: string, iv: string, authTag: string): string {
        const decipher = createDecipheriv(
            ALGORITHM,
            this.masterKey,
            Buffer.from(iv, "base64"),
            { authTagLength: TAG_LENGTH },
        );
        decipher.setAuthTag(Buffer.from(authTag, "base64"));
        const decrypted = Buffer.concat([
            decipher.update(Buffer.from(encryptedKey, "base64")),
            decipher.final(),
        ]);
        return decrypted.toString("utf8");
    }

    /**
     * Returns a masked preview of the plain-text key for admin UI display.
     * Shows first 4 and last 4 chars; everything in between is replaced with *.
     */
    static maskKey(plaintext: string): string {
        if (plaintext.length <= 8) return "****";
        return plaintext.slice(0, 4) + "*".repeat(plaintext.length - 8) + plaintext.slice(-4);
    }

    /**
     * Derives a deterministic fingerprint (first 8 hex chars of HMAC-SHA256)
     * for deduplication checks without storing the plain-text.
     */
    fingerprint(plaintext: string): string {
        return createHmac("sha256", this.masterKey)
            .update(plaintext, "utf8")
            .digest("hex")
            .slice(0, 8);
    }
}
