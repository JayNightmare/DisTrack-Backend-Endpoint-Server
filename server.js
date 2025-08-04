const express = require("express");
const app = express();
const { connectToDatabase } = require("./database.js");
const PORT = 7071;
const User = require("./User.js");
const CodingSession = require("./CodingSession.js");
const LeaderboardService = require("./LeaderboardService.js");
const SnapshotScheduler = require("./SnapshotScheduler.js");
const CronScheduler = require("./CronScheduler.js");
const MonitoringService = require("./MonitoringService.js");
const DataRetentionService = require("./DataRetentionService.js");
const { API_KEY } = require("./config.js");

app.use(express.json());

connectToDatabase();

// Initialize cron jobs for automated snapshots
CronScheduler.initializeJobs();

// * Enter Point
app.get("/", (req, res) => {
    res.send(
        "EW! Stop lookingg at me FEMBOY! FEMBOYYYYY!!!! YOU'RE A FEMBOY! I KNOW YOU ARE! I CAN SEE IT IN YOUR EYES! YOU'RE A FEMBOY! STOP LOOKING AT ME, FEMBOY!"
    );
    console.log("Server is running!");
});

// * Record the coding session
app.post("/coding-session", async (req, res) => {
    console.log("Received coding session request:", req.body);
    const { userId, duration, sessionDate, languages } = req.body;

    if (!userId || !duration || !sessionDate) {
        console.log("Missing required fields:", {
            userId,
            duration,
            sessionDate,
        });
        return res.status(400).json({ message: "Missing required fields" });
    }

    try {
        let user = await User.findOne({ userId });
        console.log("User found:", user);
        const today = new Date(sessionDate);

        // If user doesn't exist, create a new document
        if (!user) {
            console.log("Creating new user:", userId);
            user = new User({ userId });
        }

        const lastSessionDate = user.lastSessionDate
            ? new Date(user.lastSessionDate)
            : null;
        console.log("Last session date:", lastSessionDate);

        // Update total coding time
        user.totalCodingTime += duration;
        console.log("Updated total coding time:", user.totalCodingTime);

        // Streak logic
        if (lastSessionDate) {
            const daysBetween = Math.floor(
                (today - lastSessionDate) / (1000 * 60 * 60 * 24)
            );
            console.log("Days between sessions:", daysBetween);

            if (daysBetween === 1) {
                user.currentStreak += 1;
                console.log("Increased streak:", user.currentStreak);
            } else if (daysBetween > 1) {
                user.currentStreak = 1;
                console.log("Reset streak to 1");
            }
        } else {
            user.currentStreak = 1;
            console.log("First session, streak set to 1");
        }

        // Update longest streak if the current streak exceeds it
        if (user.currentStreak > user.longestStreak) {
            user.longestStreak = user.currentStreak;
            console.log("Updated longest streak:", user.longestStreak);
        }

        // Update last session date
        user.lastSessionDate = today;
        console.log("Updated last session date:", user.lastSessionDate);

        // Update language-specific coding time
        for (const lang in languages) {
            if (
                languages.hasOwnProperty(lang) &&
                user.languages.hasOwnProperty(lang)
            ) {
                user.languages[lang] += languages[lang];
                console.log(`Updated ${lang} time:`, user.languages[lang]);
            }
        }

        // Create new coding session record
        const sessionStartTime = new Date(sessionDate);
        const sessionEndTime = new Date(
            sessionStartTime.getTime() + duration * 1000
        );
        const normalizedSessionDate = new Date(
            sessionStartTime.getFullYear(),
            sessionStartTime.getMonth(),
            sessionStartTime.getDate()
        );

        const newSession = new CodingSession({
            userId: user.userId,
            username: user.username || "Anonymous",
            startTime: sessionStartTime,
            endTime: sessionEndTime,
            duration: duration,
            languages: languages || {},
            sessionDate: normalizedSessionDate,
            projectName: req.body.projectName || null,
            filePaths: req.body.filePaths || [],
        });

        // Save the session record
        await newSession.save();
        console.log("Coding session saved successfully");

        // Save the updated user document
        await user.save();
        console.log("User saved successfully");

        res.status(200).json({ message: "Session recorded successfully!" });
    } catch (error) {
        console.error("Error recording session:", error);
        return res.status(500).json({ message: "Error recording session" });
    }
});

// * Link user to the system - create or update user
app.post("/link", async (req, res) => {
    console.log("POST /link endpoint hit");
    const { userId, username, displayName, avatarUrl, discordId } = req.body;

    // Validate required fields
    if (!userId || !username) {
        return res.status(400).json({
            message:
                "Missing required fields: userId and username are required",
        });
    }

    try {
        let user = await User.findOne({ userId });

        if (!user) {
            // Create new user with Discord profile data
            user = new User({
                userId,
                username,
                displayName: displayName || username,
                avatarUrl: avatarUrl || null,
                discordId: discordId || userId,
                linkedAt: new Date(),
            });
        } else {
            // Update existing user profile
            user.username = username;
            if (displayName) user.displayName = displayName;
            if (avatarUrl) user.avatarUrl = avatarUrl;
            if (discordId) user.discordId = discordId;
            user.lastLinkedAt = new Date();
        }

        await user.save();

        res.status(200).json({
            message: "User linked successfully",
            user: {
                userId: user.userId,
                username: user.username,
                displayName: user.displayName,
                avatarUrl: user.avatarUrl,
                totalCodingTime: user.totalCodingTime,
                currentStreak: user.currentStreak,
            },
        });
    } catch (error) {
        console.error("Error linking user:", error);
        return res.status(500).json({ message: "Error linking user" });
    }
});

// * Fetch leaderboard stats - top 10 users by longest coding time
app.get("/leaderboard", async (req, res) => {
    // Add 'req' parameter
    console.log("GET /leaderboard endpoint hit");
    try {
        const users = await User.find().sort({ totalCodingTime: -1 });
        const leaderboard = users.slice(0, 10).map((user) => ({
            username: user.username || "Anonymous", // Ensure username exists
            totalCodingTime: user.totalCodingTime,
            userId: user.userId,
        }));
        res.status(200).json(leaderboard); // Send array directly instead of wrapping in object
    } catch (error) {
        console.error("Error fetching leaderboard:", error);
        return res.status(500).json({
            error: "Internal server error",
            details: error.message,
        });
    }
});

app.get("/user-profile/:userId", async (req, res) => {
    const { userId } = req.params;
    console.log(`GET /user-profile/${userId} endpoint hit`);

    try {
        const user = await User.findOne({ userId });
        if (!user) {
            return res.status(404).json({ message: "User not found" });
        }

        const userProfile = {
            userId: user.userId,
            username: user.username,
            totalCodingTime: user.totalCodingTime,
            currentStreak: user.currentStreak,
            longestStreak: user.longestStreak,
            lastSessionDate: user.lastSessionDate,
        };

        res.status(200).json(userProfile);
        console.log(`User profile for ${userId} retrieved successfully.`);
    } catch (error) {
        console.error("Error fetching user profile:", error);
        return res.status(500).json({ message: "Error fetching user profile" });
    }
});

// Get streak data for a user
app.get("/streak/:userId", async (req, res) => {
    const { userId } = req.params;
    console.log(`GET /streak/${userId} endpoint hit`);

    try {
        const user = await User.findOne({ userId });
        if (!user) {
            return res.status(404).json({ message: "User not found" });
        }

        const streakData = {
            currentStreak: user.currentStreak,
            longestStreak: user.longestStreak,
        };

        res.status(200).json(streakData);
        console.log(`Streak data for ${userId} retrieved successfully.`);
    } catch (error) {
        console.error("Error fetching streak data:", error);
        return res.status(500).json({
            message: "Error fetching streak data",
            defaultValues: { currentStreak: 0, longestStreak: 0 },
        });
    }
});

// Get language durations for a user
app.get("/languages/:userId", async (req, res) => {
    const { userId } = req.params;
    console.log(`GET /languages/${userId} endpoint hit`);

    try {
        const user = await User.findOne({ userId });
        if (!user) {
            return res.status(404).json({ message: "User not found" });
        }

        // Filter out languages with 0 duration
        const languages = Object.fromEntries(
            Object.entries(user.languages).filter(
                ([_, duration]) => duration > 0
            )
        );

        res.status(200).json(languages);
        console.log(`Language durations for ${userId} retrieved successfully.`);
    } catch (error) {
        console.error("Error fetching language durations:", error);
        return res.status(500).json({
            message: "Error fetching language durations",
            defaultValues: {},
        });
    }
});

// Get enhanced leaderboard with trends for a specific timeframe
app.get("/leaderboard/:timeframe", async (req, res) => {
    const { timeframe } = req.params;
    const { limit = 50 } = req.query;

    console.log(`GET /leaderboard/${timeframe} endpoint hit (limit: ${limit})`);

    // Validate timeframe
    const validTimeframes = ["day", "week", "month", "allTime"];
    if (!validTimeframes.includes(timeframe)) {
        return res.status(400).json({
            message:
                "Invalid timeframe. Must be one of: day, week, month, allTime",
        });
    }

    try {
        const leaderboard = await LeaderboardService.getLeaderboardWithTrends(
            timeframe,
            parseInt(limit)
        );

        res.status(200).json(leaderboard);
        console.log(
            `${timeframe} leaderboard with trends retrieved successfully (${leaderboard.length} entries)`
        );
    } catch (error) {
        console.error(`Error fetching ${timeframe} leaderboard:`, error);
        return res.status(500).json({
            message: `Error fetching ${timeframe} leaderboard`,
            error: error.message,
        });
    }
});

// Take a snapshot of the leaderboard for a specific timeframe
app.post("/snapshot/:timeframe", async (req, res) => {
    const { timeframe } = req.params;
    const { date } = req.body; // Optional: specify snapshot date

    console.log(`POST /snapshot/${timeframe} endpoint hit`);

    // Validate timeframe
    const validTimeframes = ["day", "week", "month", "allTime"];
    if (!validTimeframes.includes(timeframe)) {
        return res.status(400).json({
            message:
                "Invalid timeframe. Must be one of: day, week, month, allTime",
        });
    }

    try {
        const snapshotDate = date ? new Date(date) : new Date();
        const result = await LeaderboardService.takeSnapshot(
            timeframe,
            snapshotDate
        );

        if (result.success) {
            res.status(200).json(result);
        } else {
            res.status(409).json(result); // 409 Conflict for duplicate snapshots
        }

        console.log(`Snapshot result for ${timeframe}:`, result.message);
    } catch (error) {
        console.error(`Error taking ${timeframe} snapshot:`, error);
        return res.status(500).json({
            message: `Error taking ${timeframe} snapshot`,
            error: error.message,
        });
    }
});

// Take snapshots for all timeframes (useful for scheduled tasks)
app.post("/snapshots/all", async (req, res) => {
    const { date } = req.body; // Optional: specify snapshot date

    console.log("POST /snapshots/all endpoint hit");

    try {
        const snapshotDate = date ? new Date(date) : new Date();
        const results = await LeaderboardService.takeAllSnapshots(snapshotDate);

        // Check if any snapshots were successful
        const successCount = Object.values(results).filter(
            (r) => r.success
        ).length;
        const totalCount = Object.keys(results).length;

        if (successCount > 0) {
            res.status(200).json({
                message: `Successfully took ${successCount}/${totalCount} snapshots`,
                results: results,
            });
        } else {
            res.status(400).json({
                message: "No snapshots were taken successfully",
                results: results,
            });
        }

        console.log(
            `All snapshots result: ${successCount}/${totalCount} successful`
        );
    } catch (error) {
        console.error("Error taking all snapshots:", error);
        return res.status(500).json({
            message: "Error taking all snapshots",
            error: error.message,
        });
    }
});

// Get user's rank history for a specific timeframe
app.get("/user/:userId/history/:timeframe", async (req, res) => {
    const { userId, timeframe } = req.params;
    const { limit = 30 } = req.query;

    console.log(
        `GET /user/${userId}/history/${timeframe} endpoint hit (limit: ${limit})`
    );

    // Validate timeframe
    const validTimeframes = ["day", "week", "month", "allTime"];
    if (!validTimeframes.includes(timeframe)) {
        return res.status(400).json({
            message:
                "Invalid timeframe. Must be one of: day, week, month, allTime",
        });
    }

    try {
        const history = await LeaderboardService.getUserRankHistory(
            userId,
            timeframe,
            parseInt(limit)
        );

        res.status(200).json(history);
        console.log(
            `Rank history for ${userId} (${timeframe}) retrieved successfully (${history.length} entries)`
        );
    } catch (error) {
        console.error(`Error fetching rank history for ${userId}:`, error);
        return res.status(500).json({
            message: `Error fetching rank history for ${userId}`,
            error: error.message,
        });
    }
});

// Admin endpoint: Trigger manual snapshot
app.post("/admin/snapshot/trigger", async (req, res) => {
    const { timeframe } = req.body; // Optional: specific timeframe

    console.log("POST /admin/snapshot/trigger endpoint hit");

    try {
        const result = await SnapshotScheduler.triggerManualSnapshot(timeframe);

        res.status(200).json({
            message: "Manual snapshot triggered successfully",
            result: result,
        });

        console.log("Manual snapshot triggered:", result);
    } catch (error) {
        console.error("Error triggering manual snapshot:", error);
        return res.status(500).json({
            message: "Error triggering manual snapshot",
            error: error.message,
        });
    }
});

// Admin endpoint: Health check for snapshot system
app.get("/admin/snapshot/health", async (req, res) => {
    console.log("GET /admin/snapshot/health endpoint hit");

    try {
        const healthStatus = await SnapshotScheduler.healthCheck();

        res.status(200).json(healthStatus);
        console.log("Snapshot system health check completed");
    } catch (error) {
        console.error("Error in snapshot health check:", error);
        return res.status(500).json({
            message: "Error in snapshot health check",
            error: error.message,
        });
    }
});

// Admin endpoint: Run scheduled jobs manually (for testing)
app.post("/admin/jobs/:jobType", async (req, res) => {
    const { jobType } = req.params;

    console.log(`POST /admin/jobs/${jobType} endpoint hit`);

    try {
        let result;

        switch (jobType) {
            case "daily":
                result = await SnapshotScheduler.dailySnapshotJob();
                break;
            case "weekly":
                result = await SnapshotScheduler.weeklySnapshotJob();
                break;
            case "monthly":
                result = await SnapshotScheduler.monthlySnapshotJob();
                break;
            default:
                return res.status(400).json({
                    message:
                        "Invalid job type. Must be one of: daily, weekly, monthly",
                });
        }

        res.status(200).json({
            message: `${jobType} job executed successfully`,
            result: result,
        });

        console.log(`${jobType} job executed:`, result);
    } catch (error) {
        console.error(`Error running ${jobType} job:`, error);
        return res.status(500).json({
            message: `Error running ${jobType} job`,
            error: error.message,
        });
    }
});

// System monitoring endpoints
app.get("/admin/system/stats", async (req, res) => {
    console.log("GET /admin/system/stats endpoint hit");

    try {
        const stats = await MonitoringService.getSystemStats();
        res.status(200).json({
            success: true,
            stats: stats,
        });
    } catch (error) {
        console.error("Error getting system stats:", error);
        res.status(500).json({
            success: false,
            message: "Error getting system stats",
            error: error.message,
        });
    }
});

app.get("/admin/system/health", async (req, res) => {
    console.log("GET /admin/system/health endpoint hit");

    try {
        const health = await MonitoringService.checkSnapshotHealth();
        res.status(health.success ? 200 : 500).json(health);
    } catch (error) {
        console.error("Error checking system health:", error);
        res.status(500).json({
            success: false,
            message: "Error checking system health",
            error: error.message,
        });
    }
});

app.get("/admin/cron/status", async (req, res) => {
    console.log("GET /admin/cron/status endpoint hit");

    try {
        const status = CronScheduler.getJobStatus();
        res.status(200).json({
            success: true,
            cronJobs: status,
        });
    } catch (error) {
        console.error("Error getting cron status:", error);
        res.status(500).json({
            success: false,
            message: "Error getting cron status",
            error: error.message,
        });
    }
});

// Get recent coding sessions for debugging
app.get("/admin/sessions/recent", async (req, res) => {
    const { limit = 20 } = req.query;
    console.log(`GET /admin/sessions/recent endpoint hit (limit: ${limit})`);

    try {
        const sessions = await CodingSession.find({})
            .sort({ createdAt: -1 })
            .limit(parseInt(limit))
            .lean();

        res.status(200).json({
            success: true,
            sessions: sessions,
            count: sessions.length,
        });
    } catch (error) {
        console.error("Error getting recent sessions:", error);
        res.status(500).json({
            success: false,
            message: "Error getting recent sessions",
            error: error.message,
        });
    }
});

// Middleware for API key authentication
function authenticateApiKey(req, res, next) {
    const token = req.headers["authorization"]?.split(" ")[1];
    if (!token || token !== API_KEY) {
        return res.status(403).json({ message: "Forbidden: Invalid API Key" });
    }
    next();
}

// Admin endpoint: Manual database cleanup
app.post("/admin/cleanup", async (req, res) => {
    console.log("POST /admin/cleanup endpoint hit");

    try {
        const result = await DataRetentionService.runFullCleanup();
        res.status(200).json({
            message: "Database cleanup completed successfully",
            results: result,
        });
        console.log("Manual cleanup completed:", result);
    } catch (error) {
        console.error("Error during manual cleanup:", error);
        res.status(500).json({
            message: "Database cleanup failed",
            error: error.message,
        });
    }
});

// Admin endpoint: Database statistics
app.get("/admin/stats", async (req, res) => {
    console.log("GET /admin/stats endpoint hit");

    try {
        const stats = await DataRetentionService.getDatabaseStats();
        res.status(200).json(stats);
        console.log("Database stats retrieved:", stats);
    } catch (error) {
        console.error("Error getting database stats:", error);
        res.status(500).json({
            message: "Failed to get database stats",
            error: error.message,
        });
    }
});

// Apply API key authentication to all endpoints except Leaderboard and root
app.use((req, res, next) => {
    if (
        req.method === "POST" ||
        req.method === "PUT" ||
        req.method === "DELETE" ||
        (req.method === "GET" &&
            !(req.path.startsWith("/leaderboard") || req.path === "/"))
    ) {
        return authenticateApiKey(req, res, next);
    }
    next();
});

app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
