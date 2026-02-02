/**
 * Encryption utilities for storing sensitive data
 * Uses Node.js crypto module with AES-256-GCM
 */

import * as crypto from "crypto";
import * as os from "os";

// Algorithm for encryption
const ALGORITHM = "aes-256-gcm";
const KEY_LENGTH = 32; // 256 bits
const IV_LENGTH = 16; // 128 bits for GCM
const AUTH_TAG_LENGTH = 16;

/**
 * Derive an encryption key from machine-specific data
 * This ensures the encrypted data can only be decrypted on the same machine
 */
function deriveKey(): Buffer {
  // Use machine-specific information to derive a key
  const machineId = os.hostname() + os.platform() + os.arch();

  // Use PBKDF2 to derive a key from the machine ID
  return crypto.pbkdf2Sync(
    machineId,
    "streamdeck-docker-salt-v1", // Salt
    100000, // Iterations
    KEY_LENGTH,
    "sha256"
  );
}

/**
 * Encrypt sensitive text
 *
 * @param plaintext - The text to encrypt
 * @returns Encrypted text with IV and auth tag (base64 encoded)
 */
export function encrypt(plaintext: string): string {
  if (!plaintext) {
    return "";
  }

  const key = deriveKey();
  const iv = crypto.randomBytes(IV_LENGTH);

  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  let encrypted = cipher.update(plaintext, "utf8", "base64");
  encrypted += cipher.final("base64");

  const authTag = cipher.getAuthTag();

  // Return: iv + authTag + encrypted (all base64 encoded, separated by :)
  return `${iv.toString("base64")}:${authTag.toString("base64")}:${encrypted}`;
}

/**
 * Decrypt encrypted text
 *
 * @param ciphertext - The encrypted text (format: iv:authTag:encrypted)
 * @returns Decrypted plaintext
 */
export function decrypt(ciphertext: string): string {
  if (!ciphertext) {
    return "";
  }

  try {
    const parts = ciphertext.split(":");
    if (parts.length !== 3) {
      throw new Error("Invalid encrypted format");
    }

    const [ivBase64, authTagBase64, encryptedBase64] = parts;

    const key = deriveKey();
    const iv = Buffer.from(ivBase64, "base64");
    const authTag = Buffer.from(authTagBase64, "base64");
    const encrypted = Buffer.from(encryptedBase64, "base64");

    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(encrypted);
    decrypted = Buffer.concat([decrypted, decipher.final()]);

    return decrypted.toString("utf8");
  } catch (error) {
    // If decryption fails, return empty string
    // This can happen if data was encrypted on a different machine
    console.error("Decryption failed:", error);
    return "";
  }
}

/**
 * Check if a string is encrypted (has the correct format)
 *
 * @param text - Text to check
 * @returns true if appears to be encrypted
 */
export function isEncrypted(text: string): boolean {
  if (!text) {
    return false;
  }

  // Check if it has the iv:authTag:encrypted format
  const parts = text.split(":");
  return parts.length === 3 && parts.every(part => {
    try {
      Buffer.from(part, "base64");
      return true;
    } catch {
      return false;
    }
  });
}

/**
 * Encrypt sensitive fields in a settings object
 * Modifies the object in place
 *
 * @param settings - Settings object
 * @param fields - Array of field names to encrypt
 */
export function encryptFields(settings: any, fields: string[]): void {
  for (const field of fields) {
    if (settings[field] && typeof settings[field] === "string" && !isEncrypted(settings[field])) {
      settings[field] = encrypt(settings[field]);
    }
  }
}

/**
 * Decrypt sensitive fields in a settings object
 * Modifies the object in place
 *
 * @param settings - Settings object
 * @param fields - Array of field names to decrypt
 */
export function decryptFields(settings: any, fields: string[]): void {
  for (const field of fields) {
    if (settings[field] && typeof settings[field] === "string" && isEncrypted(settings[field])) {
      settings[field] = decrypt(settings[field]);
    }
  }
}
