process.env.NODE_ENV = "development";
process.env.APP_ENV = "development";
process.env.LOG_LEVEL ||= "info";

await import("../src/server.ts");
console.log("Lighthouse server ready");
