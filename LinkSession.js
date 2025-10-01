const mongoose = require("mongoose");

const STATUS = {
    PENDING: "pending",
    AUTHORIZED: "authorized",
    COMPLETED: "completed",
    EXPIRED: "expired",
};

const linkSessionSchema = new mongoose.Schema(
    {
        deviceId: { type: String, required: true, index: true },
        codeHash: { type: String, required: true, unique: true },
        pollTokenHash: { type: String, required: true, unique: true },
        status: {
            type: String,
            enum: Object.values(STATUS),
            default: STATUS.PENDING,
            index: true,
        },
        userId: { type: String, default: null, index: true },
    expiresAt: { type: Date, required: true },
        completedAt: { type: Date, default: null },
        metadata: {
            ipHash: { type: String, default: null },
            userAgent: { type: String, default: null },
        },
    },
    {
        timestamps: true,
    }
);

linkSessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
linkSessionSchema.index({ deviceId: 1, status: 1 });

linkSessionSchema.statics.STATUS = STATUS;

module.exports = mongoose.model("LinkSession", linkSessionSchema);
