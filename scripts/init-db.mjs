import fs from "fs";
import pg from "pg";

const url = process.env.POSTGRES_URL;
if (!url) throw new Error("POSTGRES_URL is not set");
const client = new pg.Client({
  connectionString: url,
  ssl: url.includes("sslmode=disable") ? false : { rejectUnauthorized: false },
});
await client.connect();
await client.query(fs.readFileSync(new URL("../schema.sql", import.meta.url), "utf8"));
await client.end();
console.log("Schema applied.");
