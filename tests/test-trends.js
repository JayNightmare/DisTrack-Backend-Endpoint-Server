const LeaderboardService = require("../LeaderboardService.js");
const SnapshotScheduler = require("../SnapshotScheduler.js");
const { connectToDatabase } = require("../database.js");

async function testLeaderboardTrends() {
    console.log("=== Testing Leaderboard Trends System ===\n");

    try {
        // Connect to database
        await connectToDatabase();
        console.log("✅ Connected to database\n");

        // 1. Test taking a snapshot
        console.log("1. Taking snapshot for allTime timeframe...");
        const snapshotResult = await LeaderboardService.takeSnapshot("allTime");
        console.log("Snapshot result:", snapshotResult);
        console.log("");

        // 2. Test getting leaderboard with trends
        console.log("2. Getting leaderboard with trends...");
        const leaderboard = await LeaderboardService.getLeaderboardWithTrends(
            "allTime",
            5
        );
        console.log("Leaderboard with trends:");
        leaderboard.forEach((user, index) => {
            let trendIcon = "→";
            if (user.rankDelta > 0) trendIcon = "↑";
            if (user.rankDelta < 0) trendIcon = "↓";

            console.log(
                `  ${user.rank}. ${user.username} ${trendIcon} (${user.rankDelta}) - ${user.totalTime}s`
            );
        });
        console.log("");

        // 3. Test health check
        console.log("3. Running health check...");
        const healthStatus = await SnapshotScheduler.healthCheck();
        console.log(
            "Health status:",
            healthStatus.success ? "✅ Healthy" : "❌ Issues detected"
        );
        console.log("Health details:", healthStatus.healthStatus);
        console.log("");

        // 4. Test manual trigger
        console.log("4. Testing manual snapshot trigger...");
        const manualResult = await SnapshotScheduler.triggerManualSnapshot(
            "day"
        );
        console.log("Manual trigger result:", manualResult);
        console.log("");

        console.log("=== All tests completed! ===");
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
    testLeaderboardTrends();
}

module.exports = { testLeaderboardTrends };
