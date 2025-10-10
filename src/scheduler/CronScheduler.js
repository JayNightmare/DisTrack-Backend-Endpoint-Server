const cron = require("node-cron");
const SnapshotScheduler = require("./SnapshotScheduler.js");
const DataRetentionService = require("../services/DataRetentionService.js");

class CronScheduler {
    static initializeJobs() {
        console.log("=== Initializing Cron Jobs ===");

        // Daily snapshots at midnight (00:00)
        cron.schedule(
            "0 0 * * *",
            async () => {
                console.log("🕛 Running daily snapshot job at midnight...");
                try {
                    const result = await SnapshotScheduler.dailySnapshotJob();
                    console.log("✅ Daily snapshot job completed:", result);
                } catch (error) {
                    console.error("❌ Daily snapshot job failed:", error);
                }
            },
            {
                scheduled: true,
                timezone: "UTC",
            }
        );

        // Weekly snapshots on Sunday at midnight (00:00)
        cron.schedule(
            "0 0 * * 0",
            async () => {
                console.log("🕛 Running weekly snapshot job on Sunday...");
                try {
                    const result = await SnapshotScheduler.weeklySnapshotJob();
                    console.log("✅ Weekly snapshot job completed:", result);
                } catch (error) {
                    console.error("❌ Weekly snapshot job failed:", error);
                }
            },
            {
                scheduled: true,
                timezone: "UTC",
            }
        );

        // Monthly snapshots on the 1st day at midnight (00:00)
        cron.schedule(
            "0 0 1 * *",
            async () => {
                console.log(
                    "🕛 Running monthly snapshot job on 1st of month..."
                );
                try {
                    const result = await SnapshotScheduler.monthlySnapshotJob();
                    console.log("✅ Monthly snapshot job completed:", result);
                } catch (error) {
                    console.error("❌ Monthly snapshot job failed:", error);
                }
            },
            {
                scheduled: true,
                timezone: "UTC",
            }
        );

        // All-time snapshots every Saturday at 1:00 AM
        cron.schedule(
            "0 1 * * 6",
            async () => {
                console.log("🕛 Running all-time snapshot job on Saturday...");
                try {
                    const result = await SnapshotScheduler.allTimeSnapshotJob();
                    console.log("✅ All-time snapshot job completed:", result);
                } catch (error) {
                    console.error("❌ All-time snapshot job failed:", error);
                }
            },
            {
                scheduled: true,
                timezone: "UTC",
            }
        );

        // Health check every hour at minute 30
        cron.schedule(
            "30 * * * *",
            async () => {
                console.log("🔍 Running hourly health check...");
                try {
                    const result = await SnapshotScheduler.healthCheck();
                    if (!result.success) {
                        console.warn(
                            "⚠️ Health check detected issues:",
                            result
                        );
                    }
                } catch (error) {
                    console.error("❌ Health check failed:", error);
                }
            },
            {
                scheduled: true,
                timezone: "UTC",
            }
        );

        // Database cleanup every Sunday at 2:00 AM (after snapshots)
        cron.schedule(
            "0 2 * * 0",
            async () => {
                console.log("🧹 Running weekly database cleanup...");
                try {
                    const result = await DataRetentionService.runFullCleanup();
                    console.log("✅ Database cleanup completed:", result);
                } catch (error) {
                    console.error("❌ Database cleanup failed:", error);
                }
            },
            {
                scheduled: true,
                timezone: "UTC",
            }
        );

        // Database stats check every Monday at 9:00 AM
        cron.schedule(
            "0 9 * * 1",
            async () => {
                console.log("📊 Running weekly database stats check...");
                try {
                    const stats = await DataRetentionService.getDatabaseStats();
                    console.log("📊 Database Statistics:", stats);

                    // Alert if storage is getting high (>100MB estimated)
                    if (stats.estimatedStorageKB > 100000) {
                        console.warn(
                            "⚠️ Database storage is getting high:",
                            stats.estimatedStorageKB,
                            "KB"
                        );
                    }
                } catch (error) {
                    console.error("❌ Database stats check failed:", error);
                }
            },
            {
                scheduled: true,
                timezone: "UTC",
            }
        );

        console.log("✅ All cron jobs initialized successfully");
        console.log("📅 Schedule:");
        console.log("  - Daily snapshots: Every day at 00:00 UTC");
        console.log("  - Weekly snapshots: Every Sunday at 00:00 UTC");
        console.log("  - Monthly snapshots: Every 1st of month at 00:00 UTC");
        console.log("  - All-time snapshots: Every Saturday at 01:00 UTC");
        console.log("  - Database cleanup: Every Sunday at 02:00 UTC");
        console.log("  - Database stats: Every Monday at 09:00 UTC");
        console.log("  - Health checks: Every hour at :30 minutes");
    }

    static stopAllJobs() {
        console.log("🛑 Stopping all cron jobs...");
        const tasks = cron.getTasks();
        tasks.forEach((task, name) => {
            task.stop();
            console.log(`  - Stopped job: ${name}`);
        });
        console.log("✅ All cron jobs stopped");
    }

    static getJobStatus() {
        const tasks = cron.getTasks();
        const status = {
            totalJobs: tasks.size,
            jobs: [],
            schedules: {
                daily: "0 0 * * * (Every day at midnight UTC)",
                weekly: "0 0 * * 0 (Every Sunday at midnight UTC)",
                monthly: "0 0 1 * * (Every 1st of month at midnight UTC)",
                allTime: "0 1 * * 6 (Every Saturday at 1:00 AM UTC)",
                cleanup: "0 2 * * 0 (Every Sunday at 2:00 AM UTC)",
                stats: "0 9 * * 1 (Every Monday at 9:00 AM UTC)",
                healthCheck: "30 * * * * (Every hour at :30 minutes)",
            },
        };

        tasks.forEach((task, name) => {
            status.jobs.push({
                name: name,
                running: task.getStatus() === "scheduled",
                status: task.getStatus(),
            });
        });

        return status;
    }

    // Manual trigger method for testing or emergency snapshots
    static async triggerSnapshot(timeframe) {
        console.log(`🔄 Manually triggering ${timeframe} snapshot...`);
        try {
            let result;
            switch (timeframe) {
                case "daily":
                case "day":
                    result = await SnapshotScheduler.dailySnapshotJob();
                    break;
                case "weekly":
                case "week":
                    result = await SnapshotScheduler.weeklySnapshotJob();
                    break;
                case "monthly":
                case "month":
                    result = await SnapshotScheduler.monthlySnapshotJob();
                    break;
                case "allTime":
                case "all-time":
                    result = await SnapshotScheduler.allTimeSnapshotJob();
                    break;
                case "cleanup":
                    result = await DataRetentionService.runFullCleanup();
                    break;
                default:
                    throw new Error(`Invalid timeframe: ${timeframe}`);
            }
            console.log(`✅ Manual ${timeframe} snapshot completed:`, result);
            return result;
        } catch (error) {
            console.error(`❌ Manual ${timeframe} snapshot failed:`, error);
            throw error;
        }
    }
}

module.exports = CronScheduler;
