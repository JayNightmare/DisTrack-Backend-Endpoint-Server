require("dotenv").config();

module.exports = {
    MONGODB_URI: process.env.MONGODB_URI,
    PORT: process.env.PORT || 3000,
    API_KEY: process.env.API_KEY,
    DISCORD_CLIENT_ID: process.env.DISCORD_CLIENT_ID,
    DISCORD_CLIENT_SECRET: process.env.DISCORD_CLIENT_SECRET,
};
