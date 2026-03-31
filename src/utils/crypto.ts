import CryptoJS from "crypto-js";
import { v4 as uuidv4 } from "uuid";

export function generateBiometricHash(facialMatrixData: string): string {
  const salt = uuidv4();
  return CryptoJS.SHA256(`${facialMatrixData}:${salt}`).toString();
}

export function generateFacialMatrixHash(facialMatrix: string): string {
  return CryptoJS.SHA256(facialMatrix).toString();
}
