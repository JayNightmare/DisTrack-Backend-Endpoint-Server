require("dotenv").config();

module.exports = {
    MONGODB_URI: process.env.MONGODB_URI,
    PORT: process.env.PORT || 3000,
    API_KEY: process.env.API_KEY,
    DISCORD_CLIENT_ID: process.env.DISCORD_CLIENT_ID,
    DISCORD_CLIENT_SECRET: process.env.DISCORD_CLIENT_SECRET,
    DISCORD_BOT_TOKEN: "",
    DISCORD_CALLBACK_URL:
        process.env.DISCORD_CALLBACK_URL || "url to discord auth call back",
    JWT_SECRET: process.env.JWT_SECRET || "your-jwt-secret-key",
    SESSION_SECRET: process.env.SESSION_SECRET || "your-session-secret-key",
    LINK_WEBHOOK_URL: process.env.LINK_WEBHOOK_URL || "webhook.link",
    LINK_CODE_LENGTH: 6,
    LINK_CODE_RATE_LIMIT_WINDOW_MS: 300000, // 5 minutes
    LINK_CODE_RATE_LIMIT_MAX: 5,
    EXTENSION_LINK_MAX_FAILURES: 10,
    EXTENSION_LINK_FAILURE_WINDOW_MS: 600000, // 10 minutes
    EXTENSION_LINK_LOCKOUT_MS: 300000, // 5 minutes
};
