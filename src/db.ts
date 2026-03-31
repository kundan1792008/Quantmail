import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "./generated/prisma/client/index.js";
import path from "node:path";

const DB_PATH = process.env["QUANTMAIL_DB_PATH"] ?? path.join(process.cwd(), "quantmail.db");

function createPrismaClient(dbPath: string = DB_PATH): PrismaClient {
  const adapter = new PrismaBetterSqlite3({ url: dbPath });
  return new PrismaClient({ adapter });
}

let prisma: PrismaClient | undefined;

export function getPrisma(dbPath?: string): PrismaClient {
  if (!prisma) {
    prisma = createPrismaClient(dbPath);
  }
  return prisma;
}

export { createPrismaClient };
