const express = require("express");
const path = require("path");
const crypto = require("crypto");
const app = express();
const { connectToDatabase } = require("./database.js");
const PORT = 7071;
const User = require("./User.js");
const Device = require("./Device.js");
const LinkSession = require("./LinkSession.js");
const CodingSession = require("./CodingSession.js");
const LeaderboardService = require("./LeaderboardService.js");
const StatsService = require("./StatsService.js");
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
    issueTokenPair,
    verifyAccessToken: verifySessionAccessToken,
    findValidRefreshToken,
    rotateRefreshToken,
    hashValue,
    getAccessTokenTtlSeconds,
    DEFAULT_SCOPE,
} = require("./tokenService.js");
const {
    API_KEY,
    DISCORD_CLIENT_ID,
    DISCORD_CLIENT_SECRET,
    DISCORD_CALLBACK_URL,
    JWT_SECRET,
    SESSION_SECRET,
    LINK_CODE_LENGTH,
    LINK_CODE_RATE_LIMIT_WINDOW_MS,
    LINK_CODE_RATE_LIMIT_MAX,
    EXTENSION_LINK_MAX_FAILURES,
    EXTENSION_LINK_FAILURE_WINDOW_MS,
    EXTENSION_LINK_LOCKOUT_MS,
    LINK_CODE_EXPIRES_IN_SECONDS,
    SESSION_BURST_LIMIT_PER_MINUTE,
    SESSION_DAILY_LIMIT_PER_USER,
    LINK_WEBHOOK_URL,
} = require("./config.js");
const LINK_SESSION_STATUS = LinkSession.STATUS;

function getClientIP(req) {
    return (
        req.headers["x-forwarded-for"]?.split(",")[0]?.trim() ||
        req.headers["x-real-ip"] ||
        req.connection?.remoteAddress ||
        req.socket?.remoteAddress ||
        req.ip ||
        "unknown"
    );
}

function hashIp(ip) {
    if (!ip || ip === "unknown") return null;
    return hashValue(ip);
}

const sessionRateLimitWindowMs = 60 * 1000;
const sessionRateTracker = new Map();
const sessionDailyTracker = new Map();
const LINK_CODE_EXPIRY_SECONDS = LINK_CODE_EXPIRES_IN_SECONDS || 600;

function normalizeDeviceId(deviceId) {
    if (!deviceId) return null;
    return String(deviceId).trim();
}

function getBearerToken(req) {
    const authHeader = req.headers["authorization"];
    if (!authHeader || !authHeader.toLowerCase().startsWith("bearer ")) {
        return null;
    }
    return authHeader.slice(7).trim();
}

function isBurstLimited(deviceId) {
    if (!deviceId) return false;
    const now = Date.now();
    const windowStart = now - sessionRateLimitWindowMs;
    const timestamps = (sessionRateTracker.get(deviceId) || []).filter(
        (ts) => ts >= windowStart
    );

    if (timestamps.length >= SESSION_BURST_LIMIT_PER_MINUTE) {
        sessionRateTracker.set(deviceId, timestamps);
        return true;
    }

    timestamps.push(now);
    sessionRateTracker.set(deviceId, timestamps);
    return false;
}

function getDailyTrackerEntry(userId) {
    if (!userId) return null;
    const todayKey = new Date().toISOString().slice(0, 10);
    const trackerKey = `${userId}:${todayKey}`;
    let entry = sessionDailyTracker.get(trackerKey);

    if (!entry || entry.day !== todayKey) {
        entry = { count: 0, day: todayKey };
        sessionDailyTracker.set(trackerKey, entry);
    }

    return { entry, trackerKey };
}

function hasReachedDailyLimit(userId) {
    const data = getDailyTrackerEntry(userId);
    if (!data) return false;
    return data.entry.count >= SESSION_DAILY_LIMIT_PER_USER;
}

function incrementDailyUsage(userId) {
    const data = getDailyTrackerEntry(userId);
    if (!data) return;
    data.entry.count += 1;
    sessionDailyTracker.set(data.trackerKey, data.entry);
}

async function recordSessionForUser({
    userId,
    sessionId,
    duration,
    sessionStart,
    languages = {},
    projectName = null,
    filePaths = [],
    usernameFallback = "Anonymous",
    deviceId = null,
    ipHash = null,
    userAgent = null,
    editor = null,
    extensionVersion = null,
}) {
    if (!userId) {
        throw new Error("userId is required");
    }

    const durationSeconds = Number(duration);
    if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
        throw new Error("duration must be a positive number of seconds");
    }

    const sessionStartTime = new Date(sessionStart);
    if (Number.isNaN(sessionStartTime.getTime())) {
        throw new Error("sessionStart must be a valid date");
    }

    const sessionEndTime = new Date(
        sessionStartTime.getTime() + durationSeconds * 1000
    );
    const normalizedSessionDate = new Date(
        sessionStartTime.getFullYear(),
        sessionStartTime.getMonth(),
        sessionStartTime.getDate()
    );

    let user = await User.findOne({ userId }).exec();
    if (!user) {
        user = new User({
            userId,
            username: usernameFallback || "Anonymous",
            displayName: usernameFallback || "Anonymous",
            linkedAt: new Date(),
            lastLinkedAt: new Date(),
        });
    }

    if (sessionId) {
        const existingSession = await CodingSession.findOne({
            sessionId,
        }).exec();
        if (existingSession) {
            return { created: false, session: existingSession, user };
        }
    }

    const lastSessionDate = user.lastSessionDate
        ? new Date(user.lastSessionDate)
        : null;

    user.totalCodingTime += durationSeconds;

    if (lastSessionDate) {
        const getLocalCalendarDate = (date, timezone) => {
            try {
                const localDate = new Date(
                    date.toLocaleString("en-US", { timeZone: timezone })
                );
                return new Date(
                    localDate.getFullYear(),
                    localDate.getMonth(),
                    localDate.getDate()
                );
            } catch (error) {
                console.warn(
                    `Invalid timezone '${timezone}', falling back to UTC`
                );
                return new Date(
                    date.getUTCFullYear(),
                    date.getUTCMonth(),
                    date.getUTCDate()
                );
            }
        };

        const userTimezone = user.timezone || "Europe/London";
        const todayLocalCalendar = getLocalCalendarDate(
            sessionStartTime,
            userTimezone
        );
        const lastSessionLocalCalendar = getLocalCalendarDate(
            lastSessionDate,
            userTimezone
        );

        const daysBetween = Math.floor(
            (todayLocalCalendar - lastSessionLocalCalendar) /
                (1000 * 60 * 60 * 24)
        );

        if (daysBetween === 0) {
            // same day; streak unchanged
        } else if (daysBetween === 1) {
            user.currentStreak += 1;
        } else if (daysBetween >= 2) {
            user.currentStreak = 1;
        }
    } else {
        user.currentStreak = 1;
    }

    if (user.currentStreak > user.longestStreak) {
        user.longestStreak = user.currentStreak;
    }

    user.lastSessionDate = sessionStartTime;

    const languagesEntries = Object.entries(languages || {});
    for (const [lang, value] of languagesEntries) {
        if (
            Object.prototype.hasOwnProperty.call(user.languages, lang) &&
            Number.isFinite(value) &&
            value > 0
        ) {
            user.languages[lang] += value;
        }
    }

    const newSession = new CodingSession({
        sessionId: sessionId || undefined,
        userId: user.userId,
        username: user.username || usernameFallback || "Anonymous",
        startTime: sessionStartTime,
        endTime: sessionEndTime,
        duration: durationSeconds,
        languages: languages || {},
        sessionDate: normalizedSessionDate,
        projectName: projectName || null,
        filePaths: Array.isArray(filePaths) ? filePaths : [],
        deviceId: deviceId || null,
        ipHash: ipHash || null,
        userAgent: userAgent || null,
        editor: editor || null,
        extensionVersion: extensionVersion || null,
    });

    await newSession.save();
    await user.save();

    return { created: true, session: newSession, user };
}

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
                const isNew = !user;

                if (!user) {
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
                } else {
                    user.username = profile.username;
                    user.displayName = profile.global_name || profile.username;
                    user.avatarUrl = profile.avatar
                        ? `https://cdn.discordapp.com/avatars/${profile.id}/${profile.avatar}.png`
                        : null;
                    user.email = profile.email;
                    user.lastLinkedAt = new Date();
                }

                await user.save();
                console.log(
                    `${isNew ? "New user created" : "Existing user updated"}: ${
                        profile.username
                    } (${profile.id})`
                );

                // Async webhook notification
                (async () => {
                    try {
                        if (!LINK_WEBHOOK_URL)
                            return console.log("No webhook URL set");
                        const embed = {
                            title: isNew
                                ? "New Account Linked (OAuth)"
                                : "Account Re-Linked (OAuth)",
                            color: isNew ? 0x5865f2 : 0xfee75c, // blurple vs yellow
                            timestamp: new Date().toISOString(),
                            thumbnail: user.avatarUrl
                                ? { url: user.avatarUrl }
                                : undefined,
                            fields: [
                                {
                                    name: "Discord ID",
                                    value: profile.id,
                                    inline: true,
                                },
                                {
                                    name: "Username",
                                    value: profile.username,
                                    inline: true,
                                },
                                ...(profile.global_name &&
                                profile.global_name !== profile.username
                                    ? [
                                          {
                                              name: "Global Name",
                                              value: profile.global_name,
                                              inline: true,
                                          },
                                      ]
                                    : []),
                                ...(user.email
                                    ? [
                                          {
                                              name: "Email",
                                              value: user.email,
                                              inline: true,
                                          },
                                      ]
                                    : []),
                                {
                                    name: "Total Coding Time",
                                    value: `${user.totalCodingTime || 0}s`,
                                    inline: true,
                                },
                                {
                                    name: "Current Streak",
                                    value: `${user.currentStreak || 0} days`,
                                    inline: true,
                                },
                            ],
                            footer: {
                                text: isNew
                                    ? "User joined via Discord OAuth"
                                    : "User refreshed OAuth link",
                            },
                        };
                        await axios.post(
                            LINK_WEBHOOK_URL,
                            { embeds: [embed] },
                            { headers: { "Content-Type": "application/json" } }
                        );
                    } catch (whErr) {
                        console.error(
                            "Failed to send OAuth link webhook:",
                            whErr.message
                        );
                    }
                })();

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
    const isPublicStats = req.path.startsWith("/stats") && req.method === "GET";

    const isDiscordOAuth =
        req.path.startsWith("/auth/discord") &&
        (req.method === "GET" || req.method === "POST");

    const isPublicBotSharable =
        req.path.startsWith("/user") && req.method === "GET";

    const isPublicGlobalStats =
        req.path === "/stats/global/live" && req.method === "GET";

    const isPublicEndpoint =
        publicEndpoints.includes(req.path) && req.method === "GET";

    const isV1Endpoint = req.path.startsWith("/v1/");

    if (
        isPublicEndpoint ||
        isPublicLeaderboard ||
        isPublicStats ||
        isDiscordOAuth ||
        isPublicBotSharable ||
        isPublicGlobalStats ||
        isV1Endpoint
    ) {
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
    const { userId, duration, sessionDate, languages, sessionId } = req.body;

    if (!userId || !duration || !sessionDate) {
        console.log("Missing required fields:", {
            userId,
            duration,
            sessionDate,
        });
        return res.status(400).json({ message: "Missing required fields" });
    }

    try {
        const { created } = await recordSessionForUser({
            userId,
            sessionId,
            duration,
            sessionStart: sessionDate,
            languages,
            projectName: req.body.projectName || null,
            filePaths: req.body.filePaths || [],
            usernameFallback: req.body.username || "Anonymous",
        });

        res.status(200).json({
            message: created
                ? "Session recorded successfully!"
                : "Session already recorded",
        });
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
        const isNew = !user;

        if (!user) {
            user = new User({
                userId,
                username,
                displayName: displayName || username,
                avatarUrl: avatarUrl || null,
                discordId: discordId || userId,
                linkedAt: new Date(),
                lastLinkedAt: new Date(),
            });
        } else {
            user.username = username;
            if (displayName) user.displayName = displayName;
            if (avatarUrl) user.avatarUrl = avatarUrl;
            if (discordId) user.discordId = discordId;
            user.lastLinkedAt = new Date();
        }

        await user.save();

        // Fire-and-forget webhook (do not block response)
        (async () => {
            try {
                if (!LINK_WEBHOOK_URL) return console.log("No webhook URL set");
                const embed = {
                    title: isNew ? "New Account Linked" : "Account Re-Linked",
                    color: isNew ? 0x57f287 : 0xf1c40f, // green vs yellow
                    timestamp: new Date().toISOString(),
                    thumbnail: avatarUrl ? { url: avatarUrl } : undefined,
                    fields: [
                        { name: "User ID", value: userId, inline: true },
                        { name: "Username", value: username, inline: true },
                        ...(displayName && displayName !== username
                            ? [
                                  {
                                      name: "Display Name",
                                      value: displayName,
                                      inline: true,
                                  },
                              ]
                            : []),
                        ...(discordId
                            ? [
                                  {
                                      name: "Discord ID",
                                      value: discordId,
                                      inline: true,
                                  },
                              ]
                            : []),
                        {
                            name: "Total Coding Time",
                            value: `${user.totalCodingTime || 0}s`,
                            inline: true,
                        },
                        {
                            name: "Current Streak",
                            value: `${user.currentStreak || 0} days`,
                            inline: true,
                        },
                    ],
                    footer: {
                        text: isNew
                            ? "User joined the DisTrack system"
                            : "User refreshed their link",
                    },
                };

                await axios.post(
                    LINK_WEBHOOK_URL,
                    { embeds: [embed] },
                    { headers: { "Content-Type": "application/json" } }
                );
            } catch (whErr) {
                console.error("Failed to send link webhook:", whErr.message);
            }
        })();

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
            displayName: user.displayName || user.username || "Anonymous",
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

// Leaderboard growth per language across the platform
// Place BEFORE /leaderboard/:timeframe to avoid route conflicts
app.get("/leaderboard/growth", async (req, res) => {
    const { period = "week", limit = "10" } = req.query;
    console.log(
        `GET /leaderboard/growth?period=${period}&limit=${limit} endpoint hit`
    );
    try {
        // Fastest growing users by delta hours (Hall of Flame)
        const data = await StatsService.getUserGrowth(
            period,
            parseInt(limit, 10)
        );
        res.status(200).json(data);
    } catch (error) {
        console.error("Error getting leaderboard growth:", error);
        res.status(500).json({
            message: "Error getting leaderboard growth",
            error: error.message,
        });
    }
});

// * Get user profile by userId
app.get("/user-profile/:userId", async (req, res) => {
    const { userId } = req.params;
    console.log(`GET /user-profile/${userId} endpoint hit`);

    try {
        const user = await User.findOne({ userId });
        if (!user) {
            return res.status(404).json({ message: "User not found" });
        }

        // Return the complete user profile data
        // const userProfile = {
        //     userId: user.userId,
        //     username: user.username,
        //     displayName: user.displayName,
        //     avatarUrl: user.avatarUrl,
        //     discordId: user.discordId,
        //     totalCodingTime: user.totalCodingTime,
        //     currentStreak: user.currentStreak,
        //     longestStreak: user.longestStreak,
        //     lastSessionDate: user.lastSessionDate,
        //     languages: user.languages,
        //     isPublic: user.isPublic,
        //     timezone: user.timezone,
        //     bio: user.bio,
        //     socials: user.socials || {},
        //     linkedAt: user.linkedAt,
        //     lastLinkedAt: user.lastLinkedAt,
        //     createdAt: user.createdAt,
        //     updatedAt: user.updatedAt,
        // };
        const userProfile = user.toObject(); // Convert Mongoose document to plain object

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
        failureRedirect: "https://distrack.nexusgit.info/login",
    }),
    (req, res) => {
        // Successful authentication
        console.log("Discord OAuth success:", req.user);

        // Redirect with JWT token as query parameter
        const redirectUrl = `https://distrack.nexusgit.info/auth/distrack?token=${
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

// * Route: Verify JWT Token
app.post("/auth/verify-token", async (req, res) => {
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

// ---------------- v1 Device Link Flow ---------------- //

app.post("/v1/link/start", async (req, res) => {
    try {
        const { device_id: deviceIdRaw } = req.body || {};
        const deviceId = normalizeDeviceId(deviceIdRaw);

        if (!deviceId) {
            return res.status(400).json({
                message: "device_id is required",
            });
        }

        const clientIP = getClientIP(req);
        const ipHash = hashIp(clientIP);
        const userAgent = req.headers["user-agent"] || null;

        await LinkSession.deleteMany({
            deviceId,
            status: {
                $in: [
                    LINK_SESSION_STATUS.PENDING,
                    LINK_SESSION_STATUS.AUTHORIZED,
                ],
            },
        });

        const code = generateLinkCode();
        const pollToken = crypto.randomBytes(32).toString("base64url");

        const session = new LinkSession({
            deviceId,
            codeHash: hashValue(code),
            pollTokenHash: hashValue(pollToken),
            expiresAt: new Date(Date.now() + LINK_CODE_EXPIRY_SECONDS * 1000),
            metadata: {
                ipHash,
                userAgent,
            },
        });

        await session.save();

        return res.status(200).json({
            code,
            poll_token: pollToken,
            expires_in: LINK_CODE_EXPIRY_SECONDS,
        });
    } catch (error) {
        console.error("Error creating link session:", error);
        return res.status(500).json({
            message: "Failed to start link session",
        });
    }
});

app.post("/v1/link/claim", async (req, res) => {
    try {
        const { code, user_id: userId } = req.body || {};

        if (!code || !userId) {
            return res.status(400).json({
                message: "code and user_id are required",
            });
        }

        const normalizedCode = String(code).trim().toUpperCase();
        const codeHash = hashValue(normalizedCode);
        const session = await LinkSession.findOne({ codeHash }).exec();

        if (!session) {
            return res.status(404).json({ message: "Link code not found" });
        }

        if (session.expiresAt <= new Date()) {
            if (session.status !== LINK_SESSION_STATUS.EXPIRED) {
                session.status = LINK_SESSION_STATUS.EXPIRED;
                await session.save();
            }
            return res.status(410).json({ message: "Link code expired" });
        }

        if (session.status === LINK_SESSION_STATUS.COMPLETED) {
            return res.status(409).json({ message: "Link already completed" });
        }

        const user = await User.findOne({ userId }).exec();
        if (!user) {
            return res.status(404).json({ message: "User not found" });
        }

        session.userId = user.userId;
        session.status = LINK_SESSION_STATUS.AUTHORIZED;
        session.metadata = session.metadata || {};
        session.metadata.ipHash = hashIp(getClientIP(req));
        session.metadata.userAgent =
            req.headers["user-agent"] || session.metadata.userAgent || null;
        await session.save();

        user.extensionLinked = true;
        user.lastLinkedAt = new Date();
        await user.save();

        return res.status(200).json({
            success: true,
            device_id: session.deviceId,
        });
    } catch (error) {
        console.error("Error claiming link code:", error);
        return res.status(500).json({
            message: "Failed to claim link code",
        });
    }
});

app.post("/v1/link/finish", async (req, res) => {
    try {
        const { device_id: deviceIdRaw, poll_token: pollTokenRaw } =
            req.body || {};

        const deviceId = normalizeDeviceId(deviceIdRaw);
        const pollToken = pollTokenRaw ? String(pollTokenRaw).trim() : null;

        if (!deviceId || !pollToken) {
            return res.status(400).json({
                message: "device_id and poll_token are required",
            });
        }

        const pollTokenHash = hashValue(pollToken);
        const session = await LinkSession.findOne({
            deviceId,
            pollTokenHash,
        }).exec();

        if (!session) {
            return res.status(404).json({ message: "Link session not found" });
        }

        if (session.expiresAt <= new Date()) {
            if (session.status !== LINK_SESSION_STATUS.EXPIRED) {
                session.status = LINK_SESSION_STATUS.EXPIRED;
                await session.save();
            }
            return res.status(410).json({ message: "Link session expired" });
        }

        if (!session.userId || session.status === LINK_SESSION_STATUS.PENDING) {
            return res.status(202).json({ status: "pending" });
        }

        if (session.status === LINK_SESSION_STATUS.COMPLETED) {
            return res
                .status(409)
                .json({ message: "Link already completed" });
        }

        const user = await User.findOne({ userId: session.userId }).exec();
        if (!user) {
            await LinkSession.deleteOne({ _id: session._id });
            return res.status(404).json({ message: "User not found" });
        }

        const clientIP = getClientIP(req);
        const ipHash = hashIp(clientIP);
        const userAgent = req.headers["user-agent"] || null;

        const { accessToken, refreshToken, expiresIn } = await issueTokenPair({
            userId: user.userId,
            deviceId,
            ipHash,
            userAgent,
        });

        session.status = LINK_SESSION_STATUS.COMPLETED;
        session.completedAt = new Date();
        session.metadata = session.metadata || {};
        session.metadata.ipHash = session.metadata.ipHash || ipHash;
        session.metadata.userAgent = session.metadata.userAgent || userAgent;
        await session.save();

        user.extensionLinked = true;
        user.lastLinkedAt = new Date();
        await user.save();

        return res.status(200).json({
            access_token: accessToken,
            refresh_token: refreshToken,
            expires_in: expiresIn,
        });
    } catch (error) {
        console.error("Error finishing link session:", error);
        return res.status(500).json({
            message: "Failed to complete link session",
        });
    }
});

app.post("/v1/auth/refresh", async (req, res) => {
    try {
        const { device_id: deviceIdRaw, refresh_token: refreshTokenRaw } =
            req.body || {};

        const deviceId = normalizeDeviceId(deviceIdRaw);
        const refreshToken = refreshTokenRaw
            ? String(refreshTokenRaw).trim()
            : null;

        if (!deviceId || !refreshToken) {
            return res.status(400).json({
                message: "device_id and refresh_token are required",
            });
        }

        const tokenDoc = await findValidRefreshToken(deviceId, refreshToken);
        if (!tokenDoc) {
            return res.status(401).json({ message: "Invalid refresh token" });
        }

        const clientIP = getClientIP(req);
        const ipHash = hashIp(clientIP);
        const userAgent = req.headers["user-agent"] || null;

        const { accessToken, refreshToken: rotatedToken, expiresIn } =
            await rotateRefreshToken(tokenDoc, { ipHash, userAgent });

        return res.status(200).json({
            access_token: accessToken,
            refresh_token: rotatedToken,
            expires_in: expiresIn,
        });
    } catch (error) {
        console.error("Error refreshing token:", error);
        return res.status(500).json({ message: "Failed to refresh token" });
    }
});

app.post("/v1/sessions", async (req, res) => {
    try {
        const bearer = getBearerToken(req);
        if (!bearer) {
            return res.status(401).json({ message: "Missing access token" });
        }

        let tokenPayload;
        try {
            tokenPayload = verifySessionAccessToken(bearer);
        } catch (error) {
            console.warn("Access token verification failed:", error.message);
            return res.status(401).json({ message: "Invalid access token" });
        }

        const scope = tokenPayload.scope;
        const scopeHasWriteSessions = Array.isArray(scope)
            ? scope.includes(DEFAULT_SCOPE)
            : typeof scope === "string" &&
              scope
                  .split(/\s+/)
                  .filter(Boolean)
                  .includes(DEFAULT_SCOPE);

        if (!scopeHasWriteSessions) {
            return res.status(403).json({ message: "Insufficient scope" });
        }

        const userId = tokenPayload.sub;
        const deviceId = normalizeDeviceId(tokenPayload.device_id);

        if (!userId || !deviceId) {
            return res.status(401).json({ message: "Invalid token claims" });
        }

        const {
            session_id: sessionIdRaw,
            started_at: startedAt,
            duration_sec: durationSeconds,
            languages,
            project,
            editor,
            extension_version,
            file_paths,
            filePaths,
        } = req.body || {};

        const sessionId = sessionIdRaw ? String(sessionIdRaw).trim() : null;

        if (!sessionId) {
            return res
                .status(400)
                .json({ message: "session_id is required for idempotency" });
        }

        if (!startedAt) {
            return res
                .status(400)
                .json({ message: "started_at is required" });
        }

        if (!durationSeconds) {
            return res
                .status(400)
                .json({ message: "duration_sec is required" });
        }

        const existingSession = await CodingSession.findOne({
            sessionId,
        }).exec();

        if (existingSession) {
            if (existingSession.userId !== userId) {
                return res.status(409).json({
                    message: "session_id already used by another user",
                });
            }

            await Device.findOneAndUpdate(
                { deviceId },
                {
                    lastSeenAt: new Date(),
                    lastIpHash: hashIp(getClientIP(req)) || undefined,
                    userAgent: req.headers["user-agent"] || undefined,
                },
                { new: true, upsert: false }
            ).exec();

            return res.status(200).json({
                session_id: existingSession.sessionId,
                created: false,
            });
        }

        if (isBurstLimited(deviceId)) {
            return res.status(429).json({
                message: "Rate limit exceeded for device",
            });
        }

        if (hasReachedDailyLimit(userId)) {
            return res.status(429).json({
                message: "Daily session cap reached",
            });
        }

        const clientIP = getClientIP(req);
        const ipHash = hashIp(clientIP);
        const userAgent = req.headers["user-agent"] || null;

        const result = await recordSessionForUser({
            userId,
            sessionId,
            duration: durationSeconds,
            sessionStart: startedAt,
            languages,
            projectName: project || null,
            filePaths: file_paths || filePaths || [],
            usernameFallback: tokenPayload.username || userId,
            deviceId,
            ipHash,
            userAgent,
            editor: editor || null,
            extensionVersion: extension_version || null,
        });

        if (result.created) {
            incrementDailyUsage(userId);
        }

        await Device.findOneAndUpdate(
            { deviceId },
            {
                userId,
                lastSeenAt: new Date(),
                lastIpHash: ipHash || undefined,
                userAgent: userAgent || undefined,
            },
            { new: true, upsert: true, setDefaultsOnInsert: true }
        ).exec();

        return res.status(result.created ? 201 : 200).json({
            session_id: result.session.sessionId || sessionId,
            created: result.created,
        });
    } catch (error) {
        console.error("Error handling /v1/sessions:", error);
        if (
            error.message &&
            (error.message.includes("required") ||
                error.message.includes("valid"))
        ) {
            return res.status(400).json({ message: error.message });
        }
        return res.status(500).json({ message: "Failed to record session" });
    }
});

// ---------------- Link Code & Extension Endpoints ---------------- //

// Helper to generate a 6-character alphanumeric code (uppercase letters & digits)
function generateLinkCode() {
    const length = LINK_CODE_LENGTH || 6;
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // exclude ambiguous chars
    let code = "";
    for (let i = 0; i < length; i++) {
        const idx = crypto.randomInt(0, chars.length);
        code += chars.charAt(idx);
    }
    return code;
}

// In-memory rate limit trackers (can be replaced with Redis in production)
const linkCodeRateLimits = new Map(); // key: userId, value: { count, windowStart }
const linkCodeRateLimitsIP = new Map(); // key: ip, value: { count, windowStart }

// Brute-force tracking for /extension/link per IP
const extensionLinkFailures = new Map(); // key: ip, value: { failures: [], lockedUntil }

function isRateLimited(map, key, limit, windowMs) {
    const now = Date.now();
    let entry = map.get(key);
    if (!entry || now - entry.windowStart > windowMs) {
        // reset window
        entry = { count: 1, windowStart: now };
        map.set(key, entry);
        return false;
    }
    if (entry.count >= limit) return true;
    entry.count += 1;
    return false;
}

function recordExtensionFailure(ip) {
    const now = Date.now();
    let entry = extensionLinkFailures.get(ip);
    if (!entry) {
        entry = { failures: [now], lockedUntil: 0 };
        extensionLinkFailures.set(ip, entry);
        return entry;
    }
    // purge old failures
    entry.failures = entry.failures.filter(
        (t) => now - t <= EXTENSION_LINK_FAILURE_WINDOW_MS
    );
    entry.failures.push(now);
    if (
        entry.failures.length >= EXTENSION_LINK_MAX_FAILURES &&
        now > entry.lockedUntil
    ) {
        entry.lockedUntil = now + EXTENSION_LINK_LOCKOUT_MS;
    }
    return entry;
}

function checkExtensionLock(ip) {
    const now = Date.now();
    const entry = extensionLinkFailures.get(ip);
    if (entry && entry.lockedUntil > now) {
        return entry.lockedUntil - now; // ms remaining
    }
    return 0;
}

// 1. POST /user/link-code - generate and store a new link code for authenticated user
app.post("/user/link-code/:userId", async (req, res) => {
    try {
        const { userId } = req.params;
        const user = await User.findOne({ userId });
        if (!user) {
            return res.status(404).json({ message: "User not found" });
        }

        const clientIP =
            req.headers["x-forwarded-for"]?.split(",")[0]?.trim() ||
            req.ip ||
            "unknown";

        // Rate limit by user
        if (
            isRateLimited(
                linkCodeRateLimits,
                user.userId,
                LINK_CODE_RATE_LIMIT_MAX,
                LINK_CODE_RATE_LIMIT_WINDOW_MS
            )
        ) {
            return res.status(429).json({
                message: "Rate limit exceeded for user",
            });
        }

        // Rate limit by IP
        if (
            isRateLimited(
                linkCodeRateLimitsIP,
                clientIP,
                LINK_CODE_RATE_LIMIT_MAX * 2,
                LINK_CODE_RATE_LIMIT_WINDOW_MS
            )
        ) {
            return res.status(429).json({
                message: "Rate limit exceeded for IP",
            });
        }

        // Generate unique-ish code (retry a few times to avoid collision)
        let attempts = 0;
        let code;
        while (attempts < 5) {
            code = generateLinkCode();
            // We store hashed codes, so we hash candidate before lookup
            const hashedCandidate = require("crypto")
                .createHash("sha256")
                .update(code)
                .digest("hex");
            const existing = await User.findOne({ linkCode: hashedCandidate });
            if (!existing) break;
            attempts++;
        }
        if (attempts === 5) {
            return res
                .status(500)
                .json({ message: "Failed to generate unique link code" });
        }

        user.linkCode = code;
        await user.save();
        console.log(
            `[AUDIT] Link code generated for user ${user.userId} from ${clientIP}`
        );
        res.status(200).json({ linkCode: code, length: code.length });
    } catch (err) {
        console.error("Error generating link code:", err);
        res.status(500).json({ message: "Error generating link code" });
    }
});

// 2. DELETE /user/link-code - clear existing link code
app.delete("/user/link-code/:userId", async (req, res) => {
    try {
        const { userId } = req.params;
        const user = await User.findOne({ userId });
        if (!user) {
            return res.status(404).json({ message: "User not found" });
        }
        user.linkCode = null;
        await user.save();
        console.log(`[AUDIT] Link code cleared for user ${user.userId}`);
        res.status(200).json({ success: true });
    } catch (err) {
        console.error("Error clearing link code:", err);
        res.status(500).json({ message: "Error clearing link code" });
    }
});

// 3. POST /extension/link - body: { linkCode }
//    Finds user by linkCode, clears linkCode, sets extensionLinked
app.post("/extension/link", async (req, res) => {
    const { linkCode } = req.body || {};
    if (!linkCode) {
        return res.status(400).json({ message: "linkCode is required" });
    }
    try {
        const clientIP =
            req.headers["x-forwarded-for"]?.split(",")[0]?.trim() ||
            req.ip ||
            "unknown";

        // Check lockout
        const remaining = checkExtensionLock(clientIP);
        if (remaining > 0) {
            return res.status(429).json({
                message: "Too many failed attempts. Temporarily locked.",
                retryAfterMs: remaining,
            });
        }

        const user = await User.findOne({ linkCode });
        if (!user) {
            recordExtensionFailure(clientIP);
            return res
                .status(404)
                .json({ message: "Invalid or expired link code" });
        }

        user.linkCode = null; // consume code
        user.extensionLinked = true;
        await user.save();
        console.log(
            `[AUDIT] Extension linked for user ${user.userId} from ${clientIP}`
        );

        if (!LINK_WEBHOOK_URL) return console.log("No webhook URL set");
        var embed = {
            title: "Extension Linked",
            color: 0x1abc9c, // teal
            timestamp: new Date().toISOString(),
            thumbnail: user.avatarUrl ? { url: user.avatarUrl } : undefined,
            fields: [
                { name: "User ID", value: user.userId, inline: true },
                { name: "Username", value: user.username, inline: true },
                ...(user.displayName && user.displayName !== user.username
                    ? [
                          {
                              name: "Display Name",
                              value: user.displayName,
                              inline: true,
                          },
                      ]
                    : []),
                {
                    name: "Total Coding Time",
                    value: `${user.totalCodingTime || 0}s`,
                    inline: true,
                },
                {
                    name: "Current Streak",
                    value: `${user.currentStreak || 0} days`,
                    inline: true,
                },
            ],
            footer: { text: "User linked their coding extension" },
        };
        // Fire-and-forget webhook

        (async () => {
            try {
                await axios.post(LINK_WEBHOOK_URL, { embeds: [embed] });
            } catch (whErr) {
                console.error(
                    "Failed to send extension link webhook:",
                    whErr.message
                );
            }
        })();

        res.status(200).json({
            success: true,
            user: {
                userId: user.userId,
                username: user.username,
                displayName: user.displayName,
                extensionLinked: user.extensionLinked,
                totalCodingTime: user.totalCodingTime,
            },
        });
    } catch (err) {
        console.error("Error linking extension:", err);
        res.status(500).json({ message: "Error linking extension" });
    }
});

// ! Legacy API endpoints (keeping for backward compatibility)

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

        // Webhook notification (fire-and-forget)
        (async () => {
            try {
                if (!LINK_WEBHOOK_URL) return console.log("No webhook URL set");
                const isNew =
                    user.linkedAt.getTime() === user.lastLinkedAt.getTime();
                const embed = {
                    title: isNew
                        ? "New Account Linked (Legacy OAuth)"
                        : "Account Re-Linked (Legacy OAuth)",
                    color: isNew ? 0x3498db : 0xe67e22,
                    timestamp: new Date().toISOString(),
                    thumbnail: user.avatarUrl
                        ? { url: user.avatarUrl }
                        : undefined,
                    fields: [
                        {
                            name: "Discord ID",
                            value: discordUser.id,
                            inline: true,
                        },
                        {
                            name: "Username",
                            value: discordUser.username,
                            inline: true,
                        },
                        ...(discordUser.global_name &&
                        discordUser.global_name !== discordUser.username
                            ? [
                                  {
                                      name: "Global Name",
                                      value: discordUser.global_name,
                                      inline: true,
                                  },
                              ]
                            : []),
                        {
                            name: "Total Coding Time",
                            value: `${user.totalCodingTime || 0}s`,
                            inline: true,
                        },
                        {
                            name: "Current Streak",
                            value: `${user.currentStreak || 0} days`,
                            inline: true,
                        },
                    ],
                    footer: {
                        text: isNew
                            ? "User joined via legacy OAuth flow"
                            : "User refreshed legacy OAuth link",
                    },
                };
                await axios.post(
                    LINK_WEBHOOK_URL,
                    { embeds: [embed] },
                    { headers: { "Content-Type": "application/json" } }
                );
            } catch (whErr) {
                console.error(
                    "Failed to send legacy OAuth link webhook:",
                    whErr.message
                );
            }
        })();

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

        // Webhook notification
        (async () => {
            try {
                if (!LINK_WEBHOOK_URL) return console.log("No webhook URL set");
                const embed = {
                    title: "New Account Linked (Manual Discord Create)",
                    color: 0x2ecc71,
                    timestamp: new Date().toISOString(),
                    thumbnail: newUser.avatarUrl
                        ? { url: newUser.avatarUrl }
                        : undefined,
                    fields: [
                        { name: "Discord ID", value: discordId, inline: true },
                        { name: "Username", value: username, inline: true },
                        ...(displayName && displayName !== username
                            ? [
                                  {
                                      name: "Display Name",
                                      value: displayName,
                                      inline: true,
                                  },
                              ]
                            : []),
                    ],
                    footer: {
                        text: "User created via manual Discord endpoint",
                    },
                };
                await axios.post(
                    LINK_WEBHOOK_URL,
                    { embeds: [embed] },
                    { headers: { "Content-Type": "application/json" } }
                );
            } catch (whErr) {
                console.error(
                    "Failed to send manual create link webhook:",
                    whErr.message
                );
            }
        })();
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

// ----------------------------- //

/* 
    List of Endpoints for Stats API
    - getGlobalStats
    - getUserFilterStats
    - getUserLanguageStats
    - getUserHeatmapStats
*/

app.get("/stats/global", async (req, res) => {
    console.log("GET /stats/global endpoint hit");
    try {
        const stats = await StatsService.getGlobalStats();
        res.status(200).json(stats);
        console.log("Global stats retrieved successfully");
    } catch (error) {
        console.error("Error getting global stats:", error);
        res.status(500).json({
            message: "Error getting global stats",
            error: error.message,
        });
    }
});

// Live counters for homepage hero row
app.get("/stats/global/live", async (req, res) => {
    console.log("GET /stats/global/live endpoint hit");
    try {
        const data = await StatsService.getGlobalLive();
        res.status(200).json(data);
    } catch (error) {
        console.error("Error getting global live stats:", error);
        res.status(500).json({
            message: "Error getting global live stats",
            error: error.message,
        });
    }
});

// Rolling trends for homepage mini-cards
app.get("/stats/global/trends", async (req, res) => {
    const days = req.query.days ? parseInt(req.query.days, 10) : 7;
    console.log(`GET /stats/global/trends?days=${days} endpoint hit`);
    try {
        const data = await StatsService.getGlobalTrends(days);
        res.status(200).json(data);
    } catch (error) {
        console.error("Error getting global trends:", error);
        res.status(500).json({
            message: "Error getting global trends",
            error: error.message,
        });
    }
});

// 24x7 UTC hour heatmap matrix for last N days
app.get("/stats/global/heatmap/hourly", async (req, res) => {
    const window = req.query.window ? parseInt(req.query.window, 10) : 30;
    console.log(
        `GET /stats/global/heatmap/hourly?window=${window} endpoint hit`
    );
    try {
        const data = await StatsService.getGlobalHourlyHeatmap(window);
        res.status(200).json(data);
    } catch (error) {
        console.error("Error getting global hourly heatmap:", error);
        res.status(500).json({
            message: "Error getting global hourly heatmap",
            error: error.message,
        });
    }
});

// Platform language totals current vs previous period
// Query params: period=day|week|month|1d|7d|30d (default 30d), limit
app.get("/stats/global/languages", async (req, res) => {
    const { period = "30d", limit } = req.query;
    console.log(
        `GET /stats/global/languages?period=${period}${
            limit ? `&limit=${limit}` : ""
        } endpoint hit`
    );
    try {
        const data = await StatsService.getLanguageGrowth(
            period,
            limit ? parseInt(limit, 10) : undefined
        );
        res.status(200).json(data);
    } catch (error) {
        console.error("Error getting global language totals:", error);
        res.status(500).json({
            message: "Error getting global language totals",
            error: error.message,
        });
    }
});

// ----------------------------- //

// User stats with time filters
// Query params: startDate=YYYY-MM-DD, endDate=YYYY-MM-DD
app.get("/stats/:userId/filter", async (req, res) => {
    const { userId } = req.params;
    const { startDate, endDate } = req.query;
    console.log(`GET /stats/${userId}/filter endpoint hit`);
    try {
        const data = await StatsService.getUserFilterStats(userId, {
            startDate,
            endDate,
        });
        res.status(200).json(data);
    } catch (error) {
        console.error("Error getting user filter stats:", error);
        res.status(500).json({
            message: "Error getting user filter stats",
            error: error.message,
        });
    }
});

// User language stats
// Query params: startDate, endDate, topN
app.get("/stats/:userId/languages", async (req, res) => {
    const { userId } = req.params;
    const { startDate, endDate, topN } = req.query;
    console.log(`GET /stats/user/${userId}/languages endpoint hit`);
    try {
        const data = await StatsService.getUserLanguageStats(userId, {
            startDate,
            endDate,
            topN: topN ? parseInt(topN, 10) : undefined,
        });
        res.status(200).json(data);
    } catch (error) {
        console.error("Error getting user language stats:", error);
        res.status(500).json({
            message: "Error getting user language stats",
            error: error.message,
        });
    }
});

// User heatmap stats for a given year
// Query params: year=YYYY (defaults to current year)
app.get("/stats/:userId/heatmap", async (req, res) => {
    const { userId } = req.params;
    const { year } = req.query;
    console.log(`GET /stats/user/${userId}/heatmap endpoint hit`);
    try {
        const data = await StatsService.getUserHeatmapStats(userId, {
            year: year ? parseInt(year, 10) : undefined,
        });
        res.status(200).json(data);
    } catch (error) {
        console.error("Error getting user heatmap stats:", error);
        res.status(500).json({
            message: "Error getting user heatmap stats",
            error: error.message,
        });
    }
});

// ----------------------------- //

// * User Search Endpoint * //
app.get("/users/search", async (req, res) => {
    const { q, limit = 10 } = req.query;
    if (!q || q.trim().length === 0) {
        return res
            .status(400)
            .json({ message: "Query parameter 'q' is required" });
    }
    try {
        const users = await User.find({
            $or: [
                { username: new RegExp(q, "i") },
                { displayName: new RegExp(q, "i") },
            ],
        })
            .limit(Math.min(parseInt(limit, 10), 50))
            .select(
                "userId username displayName avatarUrl totalCodingTime currentStreak longestStreak"
            )
            .exec();
        res.status(200).json({ users });
    } catch (error) {
        console.error("Error searching users:", error);
        res.status(500).json({
            message: "Error searching users",
            error: error.message,
        });
    }
});

// ----------------------------- //

app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
