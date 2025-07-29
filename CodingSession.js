const mongoose = require("mongoose");

const codingSessionSchema = new mongoose.Schema(
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
        startTime: {
            type: Date,
            required: true,
        },
        endTime: {
            type: Date,
            required: true,
        },
        duration: {
            type: Number,
            required: true,
            min: 0, // Duration in seconds
        },
        languages: {
            javascript: { type: Number, default: 0 },
            html: { type: Number, default: 0 },
            css: { type: Number, default: 0 },
            python: { type: Number, default: 0 },
            c: { type: Number, default: 0 },
            cpp: { type: Number, default: 0 },
            csharp: { type: Number, default: 0 },
            dart: { type: Number, default: 0 },
            go: { type: Number, default: 0 },
            json: { type: Number, default: 0 },
            kotlin: { type: Number, default: 0 },
            matlab: { type: Number, default: 0 },
            perl: { type: Number, default: 0 },
            php: { type: Number, default: 0 },
            r: { type: Number, default: 0 },
            ruby: { type: Number, default: 0 },
            rust: { type: Number, default: 0 },
            scala: { type: Number, default: 0 },
            sql: { type: Number, default: 0 },
            swift: { type: Number, default: 0 },
            typescript: { type: Number, default: 0 },
            markdown: { type: Number, default: 0 },
            properties: { type: Number, default: 0 },
        },
        sessionDate: {
            type: Date,
            required: true,
            index: true, // Normalized date for efficient timeframe queries
        },
        projectName: {
            type: String,
            default: null,
        },
        filePaths: [
            {
                type: String,
            },
        ],
    },
    {
        timestamps: true, // Adds createdAt and updatedAt fields
    }
);

// Compound indexes for efficient timeframe queries
codingSessionSchema.index({ userId: 1, sessionDate: -1 });
codingSessionSchema.index({ sessionDate: 1 });
codingSessionSchema.index({ userId: 1, startTime: -1 });

// Static method to get sessions for a specific timeframe
codingSessionSchema.statics.getSessionsForTimeframe = async function (
    userId,
    timeframe,
    referenceDate = new Date()
) {
    let startDate;
    const endDate = new Date(referenceDate);

    switch (timeframe) {
        case "day":
            startDate = new Date(
                referenceDate.getFullYear(),
                referenceDate.getMonth(),
                referenceDate.getDate()
            );
            endDate.setDate(endDate.getDate() + 1);
            break;
        case "week":
            startDate = new Date(referenceDate);
            startDate.setDate(referenceDate.getDate() - referenceDate.getDay()); // Go to Sunday
            startDate.setHours(0, 0, 0, 0);
            break;
        case "month":
            startDate = new Date(
                referenceDate.getFullYear(),
                referenceDate.getMonth(),
                1
            );
            break;
        case "allTime":
            return await this.find({ userId }).lean();
        default:
            throw new Error(`Invalid timeframe: ${timeframe}`);
    }

    return await this.find({
        userId,
        sessionDate: { $gte: startDate, $lt: endDate },
    }).lean();
};

// Static method to calculate total time for a timeframe
codingSessionSchema.statics.getTotalTimeForTimeframe = async function (
    userId,
    timeframe,
    referenceDate = new Date()
) {
    const sessions = await this.getSessionsForTimeframe(
        userId,
        timeframe,
        referenceDate
    );
    return sessions.reduce(
        (total, session) => total + (session.duration || 0),
        0
    );
};

module.exports = mongoose.model("CodingSession", codingSessionSchema);
