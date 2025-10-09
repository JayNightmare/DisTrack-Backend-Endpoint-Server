const mongoose = require("mongoose");

const userSchema = new mongoose.Schema(
    {
        userId: { type: String, required: true, unique: true },
        // //
        username: { type: String, default: "Anonymous" },
        displayName: { type: String },
        avatarUrl: { type: String },
        linkedAt: { type: Date, default: Date.now },
        lastLinkedAt: { type: Date },
        // //
        isPublic: { type: Boolean, default: true },
        timezone: { type: String, default: "GMT+1" },
        bio: { type: String, default: "", maxlength: 500 },
        socials: { type: Object, default: {} },
        // //
        // ? Will be used for social features in the future
        followers: { type: Number, default: 0 },
        following: { type: Number, default: 0 },
        // //
        // ? Will be used for premium features in the future
        // ? (e.g., custom themes, advanced stats, etc.)
        // ? Premium will be a subscription-based model
        // ? Sponsor will be a one-time donation-based model
        // ? Users can be both premium and sponsor
        premium: { type: Boolean, default: false },
        premiumSince: { type: Date, default: null },
        sponsor: { type: String, default: false },
        sponsorSince: { type: Date, default: null },
        // //
        // ! Will be used for habit tracking and goals in the future
        // ! (e.g., daily coding goals, streaks, etc.)
        // ! Will also be used for achievements and badges
        dailyCodingTime: { type: Number, default: 0 },
        weeklyCodingTime: { type: Number, default: 0 },
        monthlyCodingTime: { type: Number, default: 0 },
        // //
        totalCodingTime: { type: Number, default: 0 },
        currentStreak: { type: Number, default: 0 },
        longestStreak: { type: Number, default: 0 },
        achievements: [
            {
                name: String,
                target: Number,
                description: String,
                category: String,
            },
        ],
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
            yaml: { type: Number, default: 0 },
            xml: { type: Number, default: 0 },
            other: { type: Number, default: 0 }, // Catch-all for any other
        },
        lastSessionDate: { type: Date, default: null },
        archived: { type: Boolean, default: false },
        archivedAt: { type: Date, default: null },
        // //
        linkCode: { type: String, default: null },
        extensionLinked: { type: Boolean, default: false },
        // //
        // ? Will be used for authenticating requests from the VSCode extension
        linkAPIKey: { type: String, default: null },
        deviceId: { type: String, default: null },
    },
    {
        timestamps: true,
    }
);

module.exports = mongoose.model("User", userSchema);
