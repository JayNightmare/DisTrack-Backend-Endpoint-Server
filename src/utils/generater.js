const { DISCORD_BOT_TOKEN } = require("../config.js");

function generateAPIKey() {
    const length = 32;
    const chars =
        "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    let key = "";
    for (let i = 0; i < length; i++) {
        key += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return { key };
}

function botToken() {
    return DISCORD_BOT_TOKEN;
}

module.exports = {
    generateAPIKey,
    botToken,
};
