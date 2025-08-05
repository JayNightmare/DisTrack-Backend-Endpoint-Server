const express = require("express");
const path = require("path");
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
const axios = require("axios");
const passport = require("passport");
const DiscordStrategy = require("passport-discord").Strategy;
const session = require("express-session");
const jwt = require("jsonwebtoken");
const {
    API_KEY,
    DISCORD_CLIENT_ID,
    DISCORD_CLIENT_SECRET,
    DISCORD_CALLBACK_URL,
    JWT_SECRET,
    SESSION_SECRET,
} = require("./config.js");

app.use(express.json());

// * Session Configuration
app.use(
    session({
        secret: SESSION_SECRET,
        resave: false,
        saveUninitialized: false,
        cookie: {
            secure: false, // Set to true in production with HTTPS
            maxAge: 24 * 60 * 60 * 1000, // 24 hours
        },
    })
);

// * Passport Configuration
passport.use(
    new DiscordStrategy(
        {
            clientID: DISCORD_CLIENT_ID,
            clientSecret: DISCORD_CLIENT_SECRET,
            callbackURL: DISCORD_CALLBACK_URL,
            scope: ["identify", "email"],
        },
        async (accessToken, refreshToken, profile, done) => {
            try {
                console.log("Discord OAuth Profile:", profile);

                // Check if user exists in our database
                let user = await User.findOne({ userId: profile.id });

                if (!user) {
                    // Create new user if they don't exist
                    user = new User({
                        userId: profile.id, // Use Discord ID as userId
                        discordId: profile.id,
                        username: profile.username,
                        displayName: profile.global_name || profile.username,
                        avatarUrl: profile.avatar
                            ? `https://cdn.discordapp.com/avatars/${profile.id}/${profile.avatar}.png`
                            : null,
                        email: profile.email,
                        linkedAt: new Date(),
                        lastLinkedAt: new Date(),
                    });
                    await user.save();
                    console.log(
                        `New user created: ${profile.username} (${profile.id})`
                    );
                } else {
                    // Update existing user info
                    user.username = profile.username;
                    user.displayName = profile.global_name || profile.username;
                    user.avatarUrl = profile.avatar
                        ? `https://cdn.discordapp.com/avatars/${profile.id}/${profile.avatar}.png`
                        : null;
                    user.email = profile.email;
                    user.lastLinkedAt = new Date();
                    await user.save();
                    console.log(
                        `Existing user updated: ${profile.username} (${profile.id})`
                    );
                }

                // Generate JWT token
                const token = jwt.sign(
                    {
                        userId: user.userId,
                        discordId: user.discordId,
                        username: user.username,
                    },
                    JWT_SECRET,
                    { expiresIn: "7d" }
                );

                // Create user data object
                const userData = {
                    id: profile.id,
                    username: profile.username,
                    avatar: profile.avatar,
                    email: profile.email,
                    access_token: accessToken,
                    jwtToken: token,
                    userProfile: {
                        userId: user.userId,
                        username: user.username,
                        displayName: user.displayName,
                        avatarUrl: user.avatarUrl,
                        totalCodingTime: user.totalCodingTime,
                        currentStreak: user.currentStreak,
                        longestStreak: user.longestStreak,
                    },
                };

                return done(null, userData);
            } catch (error) {
                console.error("Error in Discord strategy:", error);
                return done(error, null);
            }
        }
    )
);

passport.serializeUser((user, done) => done(null, user));
passport.deserializeUser((obj, done) => done(null, obj));

app.use(passport.initialize());
app.use(passport.session());

app.use((req, res, next) => {
    if (req.method === "OPTIONS") {
        console.log("🚦 Preflight request bypassed auth");
        return res.status(204).end();
    }
    next();
});

// * Enhanced Middleware for API key authentication with geo-location tracking
async function authenticateApiKey(req, res, next) {
    const authHeader = req.headers["authorization"];
    const token = authHeader?.startsWith("Bearer ")
        ? authHeader.split(" ")[1]
        : authHeader;

    // Get client IP address (considering proxies)
    const getClientIP = (req) => {
        return (
            req.headers["x-forwarded-for"]?.split(",")[0]?.trim() ||
            req.headers["x-real-ip"] ||
            req.connection?.remoteAddress ||
            req.socket?.remoteAddress ||
            req.ip ||
            "unknown"
        );
    };

    const clientIP = getClientIP(req);

    console.log("--------------------------");
    console.log("🔐 Auth check initiated...");
    console.log("Expected:", API_KEY?.substring(0, 10) + "...");
    console.log("Received:", token?.substring(0, 10) + "...");
    console.log("📍 Client IP:", clientIP);

    if (!token || token !== API_KEY) {
        console.log("❌ Authentication FAILED! 🚫");
        console.log(
            "🎭 Someone's trying to be sneaky... but we caught them! 😏"
        );
        console.log("🔍 Investigating this suspicious character...");
        console.log("🌐 Path attempted:", req.method, req.path);
        console.log("🖥️  User-Agent:", req.headers["user-agent"] || "Unknown");

        // Perform geo-location lookup if IP is valid
        if (clientIP && clientIP !== "unknown" && !clientIP.startsWith("::")) {
            try {
                console.log("🌍 Performing geo-location lookup... 🔍");
                const geoResponse = await axios.get(
                    `http://ip-api.com/json/${clientIP}`,
                    {
                        timeout: 3000, // 3 second timeout
                    }
                );

                if (geoResponse.data && geoResponse.data.status === "success") {
                    const { city, region, country, isp, org } =
                        geoResponse.data;
                    console.log("🏙️  Location detected:");
                    console.log(`   📍 City: ${city || "Unknown"}`);
                    console.log(`   🏛️  Region: ${region || "Unknown"}`);
                    console.log(`   🌍 Country: ${country || "Unknown"}`);
                    console.log(`   🌐 ISP: ${isp || "Unknown"}`);
                    console.log(`   🏢 Organization: ${org || "Unknown"}`);
                    console.log(
                        "🕵️  Well, well, well... look who we have here! 👀"
                    );
                    console.log(
                        `🎪 A visitor from ${city}, ${country} using ${isp}!`
                    );
                    console.log(
                        "🤡 Nice try, but you'll need the magic words! ✨"
                    );
                } else {
                    console.log(
                        "🤷 Geo-location lookup returned no data. Mysterious visitor! 👻"
                    );
                }
            } catch (geoError) {
                console.log("🚫 Geo-location lookup failed:", geoError.message);
                console.log("🔮 This visitor remains a mystery... spooky! 👻");
            }
        } else {
            console.log(
                "🤖 Local or invalid IP detected. Probably a bot or local testing! 🧪"
            );
        }

        console.log("🛡️  Access DENIED! I'm going to touch you  😈");
        console.log("💡 Hint: You need a valid API key, not fairy dust! ✨");

        return res.status(403).json({
            message: "Forbidden: Invalid API Key",
            hint: "🔑 You need the secret sauce! 🌶️",
        });
    }

    // Success case
    console.log("✅ Authentication SUCCESS! 🎉");
    console.log(
        "🎊 Welcome back, authorized user! You have the magic touch! ✨"
    );
    console.log("🚀 Request approved for:", req.method, req.path);
    next();
}

app.use((req, res, next) => {
    // Public endpoints that don't require authentication
    const publicEndpoints = ["/", "/health"];

    const isPublicLeaderboard =
        req.path.startsWith("/leaderboard") && req.method === "GET";
    const isDiscordOAuth =
        req.path.startsWith("/auth/discord") &&
        (req.method === "GET" || req.method === "POST");
    const isPublicEndpoint =
        publicEndpoints.includes(req.path) && req.method === "GET";

    if (isPublicEndpoint || isPublicLeaderboard || isDiscordOAuth) {
        console.log("Public endpoint accessed:", req.method, req.path);
        return next();
    }

    // All other endpoints require authentication
    console.log("Protected endpoint accessed:", req.method, req.path);
    return authenticateApiKey(req, res, next);
});

connectToDatabase();

// Initialize cron jobs for automated snapshots
CronScheduler.initializeJobs();

// * Enter Point
app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "index.html"));
    console.log("Server running! But someone is being a naughty femboy...");
});

// * Health check endpoint
app.get("/health", (req, res) => {
    res.status(200).json({
        status: "OK",
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
    });
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

        // Return the complete user profile data
        const userProfile = {
            userId: user.userId,
            username: user.username,
            displayName: user.displayName,
            avatarUrl: user.avatarUrl,
            discordId: user.discordId,
            totalCodingTime: user.totalCodingTime,
            currentStreak: user.currentStreak,
            longestStreak: user.longestStreak,
            lastSessionDate: user.lastSessionDate,
            languages: user.languages,
            isPublic: user.isPublic,
            timezone: user.timezone,
            bio: user.bio,
            socials: user.socials || {},
            linkedAt: user.linkedAt,
            lastLinkedAt: user.lastLinkedAt,
            createdAt: user.createdAt,
            updatedAt: user.updatedAt,
        };

        res.status(200).json(userProfile);
        console.log(`User profile for ${userId} retrieved successfully.`);
    } catch (error) {
        console.error("Error fetching user profile:", error);
        return res.status(500).json({ message: "Error fetching user profile" });
    }
});

// Update user profile
app.put("/user-profile/:userId", async (req, res) => {
    const { userId } = req.params;
    const {
        username,
        displayName,
        avatarUrl,
        isPublic,
        timezone,
        bio,
        socials,
    } = req.body;
    console.log(`PUT /user-profile/${userId} endpoint hit`);
    console.log("Request body:", JSON.stringify(req.body, null, 2));

    try {
        const user = await User.findOne({ userId });
        if (!user) {
            console.log(`User not found: ${userId}`);
            return res.status(404).json({ message: "User not found" });
        }

        console.log("User found, updating fields...");

        // Update fields if provided
        if (username) user.username = username;
        if (displayName) user.displayName = displayName;
        if (avatarUrl) user.avatarUrl = avatarUrl;
        if (isPublic !== undefined) user.isPublic = isPublic;
        if (timezone) user.timezone = timezone;
        if (bio !== undefined) user.bio = bio;
        if (socials !== undefined) user.socials = socials;

        user.lastLinkedAt = new Date(); // Update last linked date

        await user.save();
        console.log(`User profile for ${userId} updated successfully`);

        res.status(200).json({
            message: "User profile updated successfully",
            user: {
                userId: user.userId,
                username: user.username,
                displayName: user.displayName,
                avatarUrl: user.avatarUrl,
                bio: user.bio,
                socials: user.socials,
                isPublic: user.isPublic,
                timezone: user.timezone,
                totalCodingTime: user.totalCodingTime,
                currentStreak: user.currentStreak,
            },
        });
        console.log(`User profile for ${userId} updated successfully.`);
    } catch (error) {
        console.error("Error updating user profile:", error);
        return res.status(500).json({
            message: "Error updating user profile",
            error: error.message,
        });
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

// //

// Discord OAuth integration with Passport.js

// //

// * Route: Initiate Discord Login
app.get("/auth/discord", passport.authenticate("discord"));

// * Route: Discord OAuth Callback
app.get(
    "/auth/discord/callback",
    passport.authenticate("discord", {
        failureRedirect: "https://distrack.endpoint-system.uk/login",
    }),
    (req, res) => {
        // Successful authentication
        console.log("Discord OAuth success:", req.user);

        // Redirect with JWT token as query parameter
        const redirectUrl = `https://distrack.endpoint-system.uk/auth/distrack?token=${
            req.user.jwtToken
        }&user=${encodeURIComponent(JSON.stringify(req.user.userProfile))}`;
        res.redirect(redirectUrl);
    }
);

// * Route: Get current authenticated user
app.get("/auth/user", (req, res) => {
    if (req.isAuthenticated()) {
        res.status(200).json({
            authenticated: true,
            user: req.user,
        });
    } else {
        res.status(401).json({
            authenticated: false,
            message: "Not authenticated",
        });
    }
});

// * Route: Logout
app.get("/auth/logout", (req, res, next) => {
    req.logout((err) => {
        if (err) {
            return next(err);
        }
        res.status(200).json({
            message: "Logged out successfully",
        });
    });
});

// * JWT Token Verification Middleware
function verifyJWT(req, res, next) {
    const authHeader = req.headers["authorization"];
    const token = authHeader?.startsWith("Bearer ")
        ? authHeader.split(" ")[1]
        : authHeader;

    if (!token) {
        return res.status(401).json({
            message: "Access token required",
        });
    }

    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        req.jwtUser = decoded;
        next();
    } catch (error) {
        return res.status(403).json({
            message: "Invalid or expired token",
        });
    }
}

// * Route: Verify JWT Token
app.post("/auth/verify-token", verifyJWT, async (req, res) => {
    try {
        // Get fresh user data
        const user = await User.findOne({ userId: req.jwtUser.userId });
        if (!user) {
            return res.status(404).json({
                message: "User not found",
            });
        }

        res.status(200).json({
            valid: true,
            user: {
                userId: user.userId,
                username: user.username,
                displayName: user.displayName,
                avatarUrl: user.avatarUrl,
                totalCodingTime: user.totalCodingTime,
                currentStreak: user.currentStreak,
                longestStreak: user.longestStreak,
            },
        });
    } catch (error) {
        console.error("Error verifying token:", error);
        res.status(500).json({
            message: "Error verifying token",
            error: error.message,
        });
    }
});

// Legacy API endpoints (keeping for backward compatibility)

// Discord OAuth Callback Handler (Legacy - for API usage)
app.post("/auth/discord/callback", async (req, res) => {
    const { code, redirect_uri } = req.body;
    console.log("POST /auth/discord/callback endpoint hit (Legacy)");

    if (!code || !redirect_uri) {
        return res.status(400).json({
            message:
                "Missing required fields: code and redirect_uri are required",
        });
    }

    try {
        // Exchange the code for an access token
        const tokenResponse = await axios.post(
            "https://discord.com/api/oauth2/token",
            new URLSearchParams({
                client_id: DISCORD_CLIENT_ID,
                client_secret: DISCORD_CLIENT_SECRET,
                grant_type: "authorization_code",
                code: code,
                redirect_uri: redirect_uri,
            }),
            {
                headers: {
                    "Content-Type": "application/x-www-form-urlencoded",
                },
            }
        );

        const { access_token, token_type } = tokenResponse.data;

        // Get user info from Discord
        const userResponse = await axios.get(
            "https://discord.com/api/users/@me",
            {
                headers: {
                    Authorization: `${token_type} ${access_token}`,
                },
            }
        );

        const discordUser = userResponse.data;

        // Check if user exists in our database
        let user = await User.findOne({ userId: discordUser.id });

        if (!user) {
            // Create new user if they don't exist
            user = new User({
                userId: discordUser.id,
                discordId: discordUser.id,
                username: discordUser.username,
                displayName: discordUser.global_name || discordUser.username,
                avatarUrl: discordUser.avatar
                    ? `https://cdn.discordapp.com/avatars/${discordUser.id}/${discordUser.avatar}.png`
                    : null,
                linkedAt: new Date(),
                lastLinkedAt: new Date(),
            });
            await user.save();
            console.log(
                `New user created: ${discordUser.username} (${discordUser.id})`
            );
        } else {
            // Update existing user info
            user.username = discordUser.username;
            user.displayName = discordUser.global_name || discordUser.username;
            user.avatarUrl = discordUser.avatar
                ? `https://cdn.discordapp.com/avatars/${discordUser.id}/${discordUser.avatar}.png`
                : null;
            user.lastLinkedAt = new Date();
            await user.save();
            console.log(
                `Existing user updated: ${discordUser.username} (${discordUser.id})`
            );
        }

        // Generate JWT token
        const jwtToken = jwt.sign(
            {
                userId: user.userId,
                discordId: user.discordId,
                username: user.username,
            },
            JWT_SECRET,
            { expiresIn: "7d" }
        );

        res.status(200).json({
            access_token: access_token,
            jwt_token: jwtToken,
            user: {
                id: discordUser.id,
                username: discordUser.username,
                global_name: discordUser.global_name,
                avatar: discordUser.avatar,
                email: discordUser.email,
                verified: discordUser.verified,
            },
            userProfile: {
                userId: user.userId,
                username: user.username,
                displayName: user.displayName,
                avatarUrl: user.avatarUrl,
                totalCodingTime: user.totalCodingTime,
                currentStreak: user.currentStreak,
                longestStreak: user.longestStreak,
            },
        });

        console.log(
            `Discord OAuth successful for user: ${discordUser.username}`
        );
    } catch (error) {
        console.error(
            "Discord OAuth error:",
            error.response?.data || error.message
        );
        return res.status(500).json({
            message: "Discord OAuth authentication failed",
            error: error.response?.data || error.message,
        });
    }
});

// Check if user exists by Discord ID
app.get("/auth/discord/user/:discordId", async (req, res) => {
    const { discordId } = req.params;
    console.log(`GET /auth/discord/user/${discordId} endpoint hit`);

    try {
        const user = await User.findOne({ userId: discordId });

        if (!user) {
            return res.status(404).json({
                exists: false,
                message: "User not found",
            });
        }

        res.status(200).json({
            exists: true,
            user: {
                userId: user.userId,
                username: user.username,
                displayName: user.displayName,
                avatarUrl: user.avatarUrl,
                discordId: user.discordId,
                totalCodingTime: user.totalCodingTime,
                currentStreak: user.currentStreak,
                longestStreak: user.longestStreak,
                linkedAt: user.linkedAt,
                lastLinkedAt: user.lastLinkedAt,
            },
        });

        console.log(
            `User exists check successful for Discord ID: ${discordId}`
        );
    } catch (error) {
        console.error("Error checking user existence:", error);
        return res.status(500).json({
            message: "Error checking user existence",
            error: error.message,
        });
    }
});

// Create new user with Discord data
app.post("/auth/discord/user", async (req, res) => {
    const { discordId, username, displayName, avatarUrl, email } = req.body;
    console.log("POST /auth/discord/user endpoint hit");

    if (!discordId || !username) {
        return res.status(400).json({
            message:
                "Missing required fields: discordId and username are required",
        });
    }

    try {
        // Check if user already exists
        let existingUser = await User.findOne({ userId: discordId });

        if (existingUser) {
            return res.status(409).json({
                message: "User already exists",
                user: {
                    userId: existingUser.userId,
                    username: existingUser.username,
                    displayName: existingUser.displayName,
                    avatarUrl: existingUser.avatarUrl,
                    discordId: existingUser.discordId,
                    totalCodingTime: existingUser.totalCodingTime,
                    currentStreak: existingUser.currentStreak,
                    longestStreak: existingUser.longestStreak,
                },
            });
        }

        // Create new user
        const newUser = new User({
            userId: discordId, // Use Discord ID as userId
            discordId: discordId,
            username: username,
            displayName: displayName || username,
            avatarUrl: avatarUrl || null,
            email: email || null,
            linkedAt: new Date(),
            lastLinkedAt: new Date(),
        });

        await newUser.save();

        res.status(201).json({
            message: "User created successfully",
            user: {
                userId: newUser.userId,
                username: newUser.username,
                displayName: newUser.displayName,
                avatarUrl: newUser.avatarUrl,
                discordId: newUser.discordId,
                totalCodingTime: newUser.totalCodingTime,
                currentStreak: newUser.currentStreak,
                longestStreak: newUser.longestStreak,
                linkedAt: newUser.linkedAt,
                lastLinkedAt: newUser.lastLinkedAt,
            },
        });

        console.log(`New Discord user created: ${username} (${discordId})`);
    } catch (error) {
        console.error("Error creating Discord user:", error);
        return res.status(500).json({
            message: "Error creating Discord user",
            error: error.message,
        });
    }
});

// Get Discord OAuth URL (helper endpoint)
app.get("/auth/discord/url", (req, res) => {
    const { redirect_uri } = req.query;
    console.log("GET /auth/discord/url endpoint hit");

    if (!redirect_uri) {
        return res.status(400).json({
            message: "Missing required parameter: redirect_uri",
        });
    }

    const clientId = DISCORD_CLIENT_ID;

    if (!clientId) {
        return res.status(500).json({
            message: "Discord client ID not configured",
        });
    }

    const scopes = ["identify", "email"];
    const authUrl = `https://discord.com/api/oauth2/authorize?client_id=${clientId}&redirect_uri=${encodeURIComponent(
        redirect_uri
    )}&response_type=code&scope=${scopes.join("%20")}`;

    res.status(200).json({
        authUrl: authUrl,
        clientId: clientId,
        scopes: scopes,
    });

    console.log("Discord OAuth URL generated successfully");
});

app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
