const cron = require("node-cron");
const SnapshotScheduler = require("./SnapshotScheduler.js");

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

        console.log("✅ All cron jobs initialized successfully");
        console.log("📅 Schedule:");
        console.log("  - Daily snapshots: Every day at 00:00 UTC");
        console.log("  - Weekly snapshots: Every Sunday at 00:00 UTC");
        console.log("  - Monthly snapshots: Every 1st of month at 00:00 UTC");
        console.log("  - Health checks: Every hour at :30 minutes");
    }

    static stopAllJobs() {
        console.log("🛑 Stopping all cron jobs...");
        cron.getTasks().forEach((task, name) => {
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
        };

        tasks.forEach((task, name) => {
            status.jobs.push({
                name: name,
                running: task.getStatus() === "scheduled",
            });
        });

        return status;
    }
}

module.exports = CronScheduler;
