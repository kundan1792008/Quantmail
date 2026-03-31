import path from "node:path";
import { defineConfig } from "prisma/config";

export default defineConfig({
  earlyAccess: true,
  schema: path.join(__dirname, "prisma", "schema.prisma"),
  migrate: {
    async datasource() {
      return {
        url: "file:./dev.db",
      };
    },
  },
});
