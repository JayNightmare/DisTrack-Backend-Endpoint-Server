const mongoose = require("mongoose");

const leaderboardSnapshotSchema = new mongoose.Schema(
    {
        userId: {
            type: String,
            required: true,
            index: true, // Index for efficient queries
        },
        username: {
            type: String,
            required: true,
        },
        timeframe: {
            type: String,
            required: true,
            enum: ["day", "week", "month", "allTime"],
            index: true, // Index for timeframe queries
        },
        timestamp: {
            type: Date,
            required: true,
            default: Date.now,
            index: true, // Index for timestamp queries
        },
        rank: {
            type: Number,
            required: true,
            min: 1, // Rank starts at 1
        },
        totalTime: {
            type: Number,
            required: true,
            min: 0, // Total time cannot be negative
        },
    },
    {
        timestamps: true, // Adds createdAt and updatedAt fields
    }
);

// Compound index for efficient queries by userId, timeframe, and timestamp
leaderboardSnapshotSchema.index({ userId: 1, timeframe: 1, timestamp: -1 });

// Compound index to prevent duplicate snapshots for same timeframe on same date
leaderboardSnapshotSchema.index(
    {
        timeframe: 1,
        timestamp: 1,
    },
    {
        unique: false, // Allow multiple users for same timeframe/timestamp
    }
);

// Add a method to get the date without time for duplicate prevention
leaderboardSnapshotSchema.methods.getDateOnly = function () {
    const date = new Date(this.timestamp);
    return new Date(date.getFullYear(), date.getMonth(), date.getDate());
};

// Static method to check if snapshot exists for a specific date and timeframe
leaderboardSnapshotSchema.statics.snapshotExistsForDate = async function (
    timeframe,
    date
) {
    const startOfDay = new Date(
        date.getFullYear(),
        date.getMonth(),
        date.getDate()
    );
    const endOfDay = new Date(startOfDay);
    endOfDay.setDate(endOfDay.getDate() + 1);

    const snapshot = await this.findOne({
        timeframe: timeframe,
        timestamp: {
            $gte: startOfDay,
            $lt: endOfDay,
        },
    });

    return !!snapshot;
};

module.exports = mongoose.model(
    "LeaderboardSnapshot",
    leaderboardSnapshotSchema
);
