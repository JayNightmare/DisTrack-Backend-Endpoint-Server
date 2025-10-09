const mongoose = require("mongoose");

const refreshTokenSchema = new mongoose.Schema(
    {
        userId: { type: String, required: true, index: true },
        deviceId: { type: String, required: true, index: true },
        tokenHash: { type: String, required: true, unique: true },
        expiresAt: { type: Date, required: true },
        revokedAt: { type: Date, default: null },
        replacedByToken: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "RefreshToken",
            default: null,
        },
        metadata: {
            ipHash: { type: String, default: null },
            userAgent: { type: String, default: null },
        },
    },
    {
        timestamps: true,
    }
);

refreshTokenSchema.index({ deviceId: 1, revokedAt: 1 });
refreshTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model("RefreshToken", refreshTokenSchema);
