const mongoose = require("mongoose");

const deviceSchema = new mongoose.Schema(
    {
        deviceId: { type: String, required: true, unique: true },
        userId: { type: String, required: true, index: true },
        lastSeenAt: { type: Date, default: Date.now },
        lastIpHash: { type: String, default: null },
        userAgent: { type: String, default: null },
    },
    {
        timestamps: true,
    }
);

deviceSchema.index({ userId: 1, deviceId: 1 });

module.exports = mongoose.model("Device", deviceSchema);
