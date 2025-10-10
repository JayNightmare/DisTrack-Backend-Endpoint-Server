const LeaderboardSnapshot = require("./src/models/LeaderboardSnapshot.js");
const CodingSession = require("./src/models/CodingSession.js");
const User = require("./src/models/User.js");

class MonitoringService {
    /**
     * Check the overall health of the snapshot system
     */
    static async checkSnapshotHealth() {
        console.log("=== Snapshot System Health Check ===");

        const health = {
            success: true,
            timestamp: new Date(),
            checks: {},
            warnings: [],
            errors: [],
        };

        try {
            // Check if snapshots are being taken regularly
            await this._checkSnapshotFrequency(health);

            // Check database connectivity
            await this._checkDatabaseHealth(health);

            // Check for orphaned data
            await this._checkDataConsistency(health);

            // Check system performance
            await this._checkPerformanceMetrics(health);
        } catch (error) {
            health.success = false;
            health.errors.push(`Health check failed: ${error.message}`);
        }

        console.log(
            "Health check completed:",
            health.success ? "✅ HEALTHY" : "❌ ISSUES DETECTED"
        );

        return health;
    }

    /**
     * Check if snapshots are being taken on schedule
     */
    static async _checkSnapshotFrequency(health) {
        const timeframes = ["day", "week", "month", "allTime"];
        const now = new Date();

        for (const timeframe of timeframes) {
            try {
                const latestSnapshot = await LeaderboardSnapshot.findOne({
                    timeframe: timeframe,
                }).sort({ timestamp: -1 });

                if (!latestSnapshot) {
                    health.warnings.push(`No ${timeframe} snapshots found`);
                    continue;
                }

                const hoursSinceLastSnapshot =
                    (now - latestSnapshot.timestamp) / (1000 * 60 * 60);

                let expectedFrequency;
                switch (timeframe) {
                    case "day":
                    case "allTime":
                        expectedFrequency = 25; // Should be within 25 hours
                        break;
                    case "week":
                        expectedFrequency = 7 * 24 + 1; // Weekly + 1 hour buffer
                        break;
                    case "month":
                        expectedFrequency = 32 * 24; // Monthly + buffer
                        break;
                }

                if (hoursSinceLastSnapshot > expectedFrequency) {
                    health.warnings.push(
                        `${timeframe} snapshot is overdue (${Math.round(
                            hoursSinceLastSnapshot
                        )} hours ago)`
                    );
                }

                health.checks[`${timeframe}_snapshot`] = {
                    status:
                        hoursSinceLastSnapshot <= expectedFrequency
                            ? "healthy"
                            : "overdue",
                    lastSnapshot: latestSnapshot.timestamp,
                    hoursSince: Math.round(hoursSinceLastSnapshot),
                };
            } catch (error) {
                health.errors.push(
                    `Error checking ${timeframe} snapshots: ${error.message}`
                );
            }
        }
    }

    /**
     * Check database connectivity and basic operations
     */
    static async _checkDatabaseHealth(health) {
        try {
            // Test basic queries
            const userCount = await User.countDocuments();
            const sessionCount = await CodingSession.countDocuments();
            const snapshotCount = await LeaderboardSnapshot.countDocuments();

            health.checks.database = {
                status: "healthy",
                users: userCount,
                sessions: sessionCount,
                snapshots: snapshotCount,
            };

            if (userCount === 0) {
                health.warnings.push("No users found in database");
            }
        } catch (error) {
            health.success = false;
            health.errors.push(
                `Database health check failed: ${error.message}`
            );
            health.checks.database = {
                status: "error",
                error: error.message,
            };
        }
    }

    /**
     * Check for data consistency issues
     */
    static async _checkDataConsistency(health) {
        try {
            // Check for users without any coding sessions (if sessions exist)
            const totalUsers = await User.countDocuments();
            const totalSessions = await CodingSession.countDocuments();

            if (totalSessions > 0) {
                const usersWithSessions = await CodingSession.distinct(
                    "userId"
                );
                const usersWithoutSessions =
                    totalUsers - usersWithSessions.length;

                if (usersWithoutSessions > 0) {
                    health.warnings.push(
                        `${usersWithoutSessions} users have no coding sessions recorded`
                    );
                }
            }

            // Check for snapshots without corresponding users
            const snapshotUserIds = await LeaderboardSnapshot.distinct(
                "userId"
            );
            const userIds = await User.distinct("userId");
            const orphanedSnapshots = snapshotUserIds.filter(
                (id) => !userIds.includes(id)
            );

            if (orphanedSnapshots.length > 0) {
                health.warnings.push(
                    `${orphanedSnapshots.length} snapshots reference non-existent users`
                );
            }

            health.checks.dataConsistency = {
                status: orphanedSnapshots.length === 0 ? "healthy" : "warnings",
                orphanedSnapshots: orphanedSnapshots.length,
            };
        } catch (error) {
            health.errors.push(
                `Data consistency check failed: ${error.message}`
            );
        }
    }

    /**
     * Check system performance metrics
     */
    static async _checkPerformanceMetrics(health) {
        try {
            const startTime = Date.now();

            // Test query performance
            await LeaderboardSnapshot.findOne().sort({ timestamp: -1 });

            const queryTime = Date.now() - startTime;

            health.checks.performance = {
                status: queryTime < 1000 ? "healthy" : "slow",
                queryTime: queryTime,
                unit: "ms",
            };

            if (queryTime > 1000) {
                health.warnings.push(
                    `Database queries are slow (${queryTime}ms)`
                );
            }
        } catch (error) {
            health.errors.push(`Performance check failed: ${error.message}`);
        }
    }

    /**
     * Alert on critical issues (placeholder for webhook/email integration)
     */
    static async alertOnCriticalIssues(healthStatus) {
        if (!healthStatus.success || healthStatus.errors.length > 0) {
            console.error("🚨 CRITICAL ISSUES DETECTED:");
            healthStatus.errors.forEach((error) => {
                console.error(`  ❌ ${error}`);
            });

            // TODO: Implement actual alerting (Discord webhook, email, etc.)
            // Example:
            // await this.sendDiscordAlert(healthStatus);
            // await this.sendEmailAlert(healthStatus);
        }

        if (healthStatus.warnings.length > 0) {
            console.warn("⚠️ WARNINGS DETECTED:");
            healthStatus.warnings.forEach((warning) => {
                console.warn(`  ⚠️ ${warning}`);
            });
        }
    }

    /**
     * Get system statistics
     */
    static async getSystemStats() {
        try {
            const stats = {
                timestamp: new Date(),
                users: {
                    total: await User.countDocuments(),
                    withSessions: 0,
                },
                sessions: {
                    total: await CodingSession.countDocuments(),
                    today: 0,
                    thisWeek: 0,
                    thisMonth: 0,
                },
                snapshots: {
                    total: await LeaderboardSnapshot.countDocuments(),
                    byTimeframe: {},
                },
            };

            // Count users with sessions
            if (stats.sessions.total > 0) {
                const usersWithSessions = await CodingSession.distinct(
                    "userId"
                );
                stats.users.withSessions = usersWithSessions.length;
            }

            // Count sessions by timeframe
            const now = new Date();
            const today = new Date(
                now.getFullYear(),
                now.getMonth(),
                now.getDate()
            );
            const thisWeek = new Date(today);
            thisWeek.setDate(today.getDate() - today.getDay());
            const thisMonth = new Date(now.getFullYear(), now.getMonth(), 1);

            stats.sessions.today = await CodingSession.countDocuments({
                sessionDate: { $gte: today },
            });

            stats.sessions.thisWeek = await CodingSession.countDocuments({
                sessionDate: { $gte: thisWeek },
            });

            stats.sessions.thisMonth = await CodingSession.countDocuments({
                sessionDate: { $gte: thisMonth },
            });

            // Count snapshots by timeframe
            const timeframes = ["day", "week", "month", "allTime"];
            for (const timeframe of timeframes) {
                stats.snapshots.byTimeframe[timeframe] =
                    await LeaderboardSnapshot.countDocuments({
                        timeframe: timeframe,
                    });
            }

            return stats;
        } catch (error) {
            console.error("Error getting system stats:", error);
            throw error;
        }
    }
}

module.exports = MonitoringService;
