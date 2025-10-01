require("dotenv").config();

module.exports = {
    MONGODB_URI: process.env.MONGODB_URI,
    PORT: process.env.PORT || 3000,
    API_KEY: process.env.API_KEY,
    DISCORD_CLIENT_ID: process.env.DISCORD_CLIENT_ID,
    DISCORD_CLIENT_SECRET: process.env.DISCORD_CLIENT_SECRET,
    DISCORD_CALLBACK_URL:
        process.env.DISCORD_CALLBACK_URL || "url to discord auth call back",
    JWT_SECRET: process.env.JWT_SECRET || "your-jwt-secret-key",
    SESSION_SECRET: process.env.SESSION_SECRET || "your-session-secret-key",
    JWT_AUDIENCE: process.env.JWT_AUDIENCE || "distrack.api",
    JWT_ISSUER: process.env.JWT_ISSUER || "distrack.backend",
    ACCESS_TOKEN_TTL_SECONDS: parseInt(
        process.env.ACCESS_TOKEN_TTL_SECONDS || "900",
        10
    ),
    REFRESH_TOKEN_TTL_DAYS: parseInt(
        process.env.REFRESH_TOKEN_TTL_DAYS || "60",
        10
    ),
    LINK_CODE_EXPIRES_IN_SECONDS: parseInt(
        process.env.LINK_CODE_EXPIRES_IN_SECONDS || "600",
        10
    ),
    SESSION_BURST_LIMIT_PER_MINUTE: parseInt(
        process.env.SESSION_BURST_LIMIT_PER_MINUTE || "60",
        10
    ),
    SESSION_DAILY_LIMIT_PER_USER: parseInt(
        process.env.SESSION_DAILY_LIMIT_PER_USER || "720",
        10
    ),
    LINK_WEBHOOK_URL: process.env.LINK_WEBHOOK_URL || "webhook.link",
    LINK_CODE_LENGTH: 6,
    LINK_CODE_RATE_LIMIT_WINDOW_MS: 300000, // 5 minutes
    LINK_CODE_RATE_LIMIT_MAX: 5,
    EXTENSION_LINK_MAX_FAILURES: 10,
    EXTENSION_LINK_FAILURE_WINDOW_MS: 600000, // 10 minutes
    EXTENSION_LINK_LOCKOUT_MS: 300000, // 5 minutes
};
