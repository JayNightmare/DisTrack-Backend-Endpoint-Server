const LeaderboardService = require("./LeaderboardService.js");

class SnapshotScheduler {
    /**
     * Manual snapshot trigger for testing
     * Can be called from API endpoints or admin interface
     */
    static async triggerManualSnapshot(timeframe = null) {
        console.log("=== Manual Snapshot Trigger ===");

        if (timeframe) {
            console.log(`Taking manual snapshot for timeframe: ${timeframe}`);
            const result = await LeaderboardService.takeSnapshot(timeframe);
            console.log(`Manual snapshot result:`, result);
            return result;
        } else {
            console.log("Taking manual snapshots for all timeframes");
            const results = await LeaderboardService.takeAllSnapshots();
            console.log("Manual snapshot results:", results);
            return results;
        }
    }

    /**
     * Daily snapshot job
     * This should be called once per day (e.g., at midnight)
     */
    static async dailySnapshotJob() {
        console.log("=== Daily Snapshot Job Started ===");
        const now = new Date();
        console.log(`Running daily snapshot job at: ${now.toISOString()}`);

        try {
            // Take snapshots for day and allTime
            const results = await Promise.allSettled([
                LeaderboardService.takeSnapshot("day"),
                LeaderboardService.takeSnapshot("allTime"),
            ]);

            const dayResult = results[0];
            const allTimeResult = results[1];

            console.log("Daily snapshot results:");
            console.log(
                "- Day:",
                dayResult.status === "fulfilled"
                    ? dayResult.value
                    : dayResult.reason
            );
            console.log(
                "- AllTime:",
                allTimeResult.status === "fulfilled"
                    ? allTimeResult.value
                    : allTimeResult.reason
            );

            return {
                success: true,
                timestamp: now,
                results: {
                    day: dayResult,
                    allTime: allTimeResult,
                },
            };
        } catch (error) {
            console.error("Error in daily snapshot job:", error);
            return {
                success: false,
                timestamp: now,
                error: error.message,
            };
        }
    }

    /**
     * Weekly snapshot job
     * This should be called once per week (e.g., Sunday at midnight)
     */
    static async weeklySnapshotJob() {
        console.log("=== Weekly Snapshot Job Started ===");
        const now = new Date();
        console.log(`Running weekly snapshot job at: ${now.toISOString()}`);

        try {
            const result = await LeaderboardService.takeSnapshot("week");
            console.log("Weekly snapshot result:", result);

            return {
                success: result.success,
                timestamp: now,
                result: result,
            };
        } catch (error) {
            console.error("Error in weekly snapshot job:", error);
            return {
                success: false,
                timestamp: now,
                error: error.message,
            };
        }
    }

    /**
     * Monthly snapshot job
     * This should be called once per month (e.g., 1st day at midnight)
     */
    static async monthlySnapshotJob() {
        console.log("=== Monthly Snapshot Job Started ===");
        const now = new Date();
        console.log(`Running monthly snapshot job at: ${now.toISOString()}`);

        try {
            const result = await LeaderboardService.takeSnapshot("month");
            console.log("Monthly snapshot result:", result);

            return {
                success: result.success,
                timestamp: now,
                result: result,
            };
        } catch (error) {
            console.error("Error in monthly snapshot job:", error);
            return {
                success: false,
                timestamp: now,
                error: error.message,
            };
        }
    }

    /**
     * Initialize scheduled jobs (if using a scheduler like node-cron)
     * This is a placeholder for future implementation
     */
    static initializeScheduledJobs() {
        console.log("=== Initializing Scheduled Jobs ===");

        // TODO: Implement with node-cron or similar
        // Example:
        // const cron = require('node-cron');
        //
        // // Daily at midnight
        // cron.schedule('0 0 * * *', this.dailySnapshotJob);
        //
        // // Weekly on Sunday at midnight
        // cron.schedule('0 0 * * 0', this.weeklySnapshotJob);
        //
        // // Monthly on 1st day at midnight
        // cron.schedule('0 0 1 * *', this.monthlySnapshotJob);

        console.log("Scheduled jobs would be initialized here");
        console.log(
            "Add node-cron dependency and uncomment the cron.schedule calls"
        );
    }

    /**
     * Health check for snapshot system
     * Verifies that snapshots are being taken regularly
     */
    static async healthCheck() {
        console.log("=== Snapshot System Health Check ===");

        try {
            const LeaderboardSnapshot = require("./LeaderboardSnapshot.js");

            // Check if we have recent snapshots for each timeframe
            const timeframes = ["day", "week", "month", "allTime"];
            const healthStatus = {};

            for (const timeframe of timeframes) {
                // Check for snapshots in the last 2 days for daily/allTime
                // Last 8 days for weekly, last 32 days for monthly
                let daysBack;
                switch (timeframe) {
                    case "day":
                    case "allTime":
                        daysBack = 2;
                        break;
                    case "week":
                        daysBack = 8;
                        break;
                    case "month":
                        daysBack = 32;
                        break;
                }

                const cutoffDate = new Date();
                cutoffDate.setDate(cutoffDate.getDate() - daysBack);

                const recentSnapshot = await LeaderboardSnapshot.findOne({
                    timeframe: timeframe,
                    timestamp: { $gte: cutoffDate },
                }).sort({ timestamp: -1 });

                healthStatus[timeframe] = {
                    hasRecentSnapshot: !!recentSnapshot,
                    lastSnapshotDate: recentSnapshot
                        ? recentSnapshot.timestamp
                        : null,
                    daysSinceLastSnapshot: recentSnapshot
                        ? Math.floor(
                              (new Date() - recentSnapshot.timestamp) /
                                  (1000 * 60 * 60 * 24)
                          )
                        : null,
                };
            }

            console.log("Health check results:", healthStatus);

            return {
                success: true,
                timestamp: new Date(),
                healthStatus: healthStatus,
            };
        } catch (error) {
            console.error("Error in health check:", error);
            return {
                success: false,
                timestamp: new Date(),
                error: error.message,
            };
        }
    }
}

module.exports = SnapshotScheduler;
