import CryptoJS from "crypto-js";
import { v4 as uuidv4 } from "uuid";

export interface BiometricHashResult {
  hash: string;
  salt: string;
}

export function generateBiometricHash(facialMatrixData: string): BiometricHashResult {
  const salt = uuidv4();
  const hash = CryptoJS.SHA256(`${facialMatrixData}:${salt}`).toString();
  return { hash, salt };
}

export function generateFacialMatrixHash(facialMatrix: string): string {
  return CryptoJS.SHA256(facialMatrix).toString();
}
