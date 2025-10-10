const mongoose = require("mongoose");

const aggregatedSessionSchema = new mongoose.Schema({
    userId: { type: String, required: true, index: true },
    username: { type: String, default: "Anonymous" },
    sessionDate: { type: Date, required: true, index: true },
    totalDuration: { type: Number, default: 0 },
    sessionCount: { type: Number, default: 0 },
    languages: {
        type: Map,
        of: Number,
        default: {},
    },
    aggregated: { type: Boolean, default: true },
    createdAt: { type: Date, default: Date.now },
});

// Compound index for efficient queries
aggregatedSessionSchema.index({ userId: 1, sessionDate: 1 });

module.exports = mongoose.model("AggregatedSession", aggregatedSessionSchema);
