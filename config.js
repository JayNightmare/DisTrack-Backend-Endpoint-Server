require("dotenv").config();

module.exports = {
    MONGODB_URI: process.env.MONGODB_URI,
    PORT: process.env.PORT || 3000,
    API_KEY: process.env.API_KEY,
    DISCORD_CLIENT_ID: process.env.DISCORD_CLIENT_ID,
    DISCORD_CLIENT_SECRET: process.env.DISCORD_CLIENT_SECRET,
    DISCORD_CALLBACK_URL:
        process.env.DISCORD_CALLBACK_URL ||
        "https://api.endpoint-system.uk/auth/discord/callback",
    JWT_SECRET: process.env.JWT_SECRET || "your-jwt-secret-key",
    SESSION_SECRET: process.env.SESSION_SECRET || "your-session-secret-key",
};
