require("dotenv").config();

module.exports = {
    MONGODB_URI: process.env.MONGODB_URI,
    PORT: process.env.PORT || 3000,
    API_KEY: process.env.API_KEY
};
