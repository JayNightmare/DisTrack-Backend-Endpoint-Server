const { connectToDatabase } = require("./database.js");
const User = require("./User.js");
const CodingSession = require("./CodingSession.js");
const LeaderboardService = require("./LeaderboardService.js");
const LeaderboardSnapshot = require("./LeaderboardSnapshot.js");

async function testSessionIntegration() {
    console.log("=== Testing Session Integration ===\n");

    try {
        // Connect to database
        await connectToDatabase();
        console.log("✅ Connected to database\n");

        // Clean up any existing test data
        await User.deleteMany({ userId: /^test_/ });
        await CodingSession.deleteMany({ userId: /^test_/ });
        await LeaderboardSnapshot.deleteMany({ userId: /^test_/ });
        console.log("🧹 Cleaned up test data\n");

        // Create test users with sessions
        const testUsers = [
            { userId: "test_user_1", username: "Alice" },
            { userId: "test_user_2", username: "Bob" },
            { userId: "test_user_3", username: "Charlie" },
        ];

        const today = new Date();
        const yesterday = new Date(today);
        yesterday.setDate(yesterday.getDate() - 1);
        const lastWeek = new Date(today);
        lastWeek.setDate(lastWeek.getDate() - 7);

        console.log("1. Creating test users and sessions...");

        for (let i = 0; i < testUsers.length; i++) {
            const testUser = testUsers[i];

            // Create user
            const user = new User({
                userId: testUser.userId,
                username: testUser.username,
                totalCodingTime: (i + 1) * 3600, // 1h, 2h, 3h respectively
                lastSessionDate: today,
            });
            await user.save();

            // Create multiple sessions for different timeframes
            const sessions = [
                // Today sessions
                {
                    userId: testUser.userId,
                    username: testUser.username,
                    startTime: new Date(today.getTime() - 3600000), // 1 hour ago
                    endTime: today,
                    duration: 3600, // 1 hour
                    languages: { javascript: 3600 },
                    sessionDate: new Date(
                        today.getFullYear(),
                        today.getMonth(),
                        today.getDate()
                    ),
                },
                // Yesterday sessions
                {
                    userId: testUser.userId,
                    username: testUser.username,
                    startTime: new Date(yesterday.getTime() - 1800000), // 30 min session yesterday
                    endTime: yesterday,
                    duration: 1800,
                    languages: { python: 1800 },
                    sessionDate: new Date(
                        yesterday.getFullYear(),
                        yesterday.getMonth(),
                        yesterday.getDate()
                    ),
                },
                // Last week sessions
                {
                    userId: testUser.userId,
                    username: testUser.username,
                    startTime: new Date(lastWeek.getTime() - 7200000), // 2 hour session last week
                    endTime: lastWeek,
                    duration: 7200,
                    languages: { typescript: 7200 },
                    sessionDate: new Date(
                        lastWeek.getFullYear(),
                        lastWeek.getMonth(),
                        lastWeek.getDate()
                    ),
                },
            ];

            await CodingSession.insertMany(sessions);
        }

        console.log("✅ Test data created\n");

        // Test timeframe calculations
        console.log("2. Testing timeframe calculations...");

        const testUser = await User.findOne({ userId: "test_user_1" });

        console.log("Timeframe totals for test_user_1:");
        console.log(
            "- AllTime:",
            await LeaderboardService.getTimeframeTotal(testUser, "allTime")
        );
        console.log(
            "- Day:",
            await LeaderboardService.getTimeframeTotal(testUser, "day")
        );
        console.log(
            "- Week:",
            await LeaderboardService.getTimeframeTotal(testUser, "week")
        );
        console.log(
            "- Month:",
            await LeaderboardService.getTimeframeTotal(testUser, "month")
        );
        console.log("");

        // Test snapshot taking
        console.log("3. Testing snapshot taking...");
        const snapshotResult = await LeaderboardService.takeSnapshot("day");
        console.log("Day snapshot result:", snapshotResult.message);
        console.log("");

        // Test leaderboard with trends
        console.log("4. Testing leaderboard with trends...");

        // Take another snapshot to test trend calculation
        await new Promise((resolve) => setTimeout(resolve, 1000)); // Wait 1 second

        // Modify user data slightly to simulate change
        await User.updateOne(
            { userId: "test_user_2" },
            { $inc: { totalCodingTime: 1800 } } // Add 30 minutes
        );

        // Add another session for user 2
        const newSession = new CodingSession({
            userId: "test_user_2",
            username: "Bob",
            startTime: new Date(),
            endTime: new Date(),
            duration: 1800,
            languages: { javascript: 1800 },
            sessionDate: new Date(
                today.getFullYear(),
                today.getMonth(),
                today.getDate()
            ),
        });
        await newSession.save();

        // Take second snapshot
        const secondSnapshot = await LeaderboardService.takeSnapshot("day");
        console.log("Second snapshot result:", secondSnapshot.message);

        // Get leaderboard with trends
        const leaderboard = await LeaderboardService.getLeaderboardWithTrends(
            "day",
            5
        );
        console.log("\nDay Leaderboard with Trends:");
        leaderboard.forEach((user) => {
            let trendIcon = "→";
            if (user.rankDelta > 0) trendIcon = "↑";
            if (user.rankDelta < 0) trendIcon = "↓";

            console.log(
                `  ${user.rank}. ${user.username} ${trendIcon} (${
                    user.rankDelta
                }) - ${Math.floor(user.totalTime / 60)}min`
            );
        });
        console.log("");

        // Test session queries directly
        console.log("5. Testing direct session queries...");
        const todaySessions = await CodingSession.getSessionsForTimeframe(
            "test_user_1",
            "day"
        );
        console.log(`test_user_1 has ${todaySessions.length} sessions today`);

        const weekSessions = await CodingSession.getSessionsForTimeframe(
            "test_user_1",
            "week"
        );
        console.log(
            `test_user_1 has ${weekSessions.length} sessions this week`
        );
        console.log("");

        console.log("=== All tests completed successfully! ===");

        // Clean up test data
        await User.deleteMany({ userId: /^test_/ });
        await CodingSession.deleteMany({ userId: /^test_/ });
        await LeaderboardSnapshot.deleteMany({ userId: /^test_/ });
        console.log("🧹 Test data cleaned up");
    } catch (error) {
        console.error("❌ Test failed:", error);
    } finally {
        // Close database connection
        const mongoose = require("mongoose");
        await mongoose.connection.close();
        console.log("Database connection closed");
    }
}

// Run tests if called directly
if (require.main === module) {
    testSessionIntegration();
}

module.exports = { testSessionIntegration };
