const mongoose = require("mongoose");

const userSchema = new mongoose.Schema({
    userId: { type: String, required: true, unique: true },
    totalCodingTime: { type: Number, default: 0 },
    // Additional fields as needed
});

module.exports = mongoose.model("User", userSchema);
