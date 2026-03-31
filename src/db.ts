import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "../generated/prisma/client/index.js";

const adapter = new PrismaBetterSqlite3({ url: "file:./dev.db" });

export const prisma = new PrismaClient({ adapter });
