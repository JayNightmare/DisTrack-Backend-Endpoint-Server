const CodingSession = require("../models/CodingSession.js");
const LeaderboardSnapshot = require("../models/LeaderboardSnapshot.js");
const User = require("../models/User.js");

class DataRetentionService {
    static retentionPolicies = {
        codingSessions: {
            detailed: 90, // Keep detailed sessions for 90 days
            aggregated: 365, // Keep aggregated data for 1 year
            archive: 1095, // Archive after 3 years
        },
        leaderboardSnapshots: {
            daily: 30, // Keep daily snapshots for 30 days
            weekly: 180, // Keep weekly snapshots for 6 months
            monthly: 730, // Keep monthly snapshots for 2 years
            allTime: -1, // Keep all-time snapshots forever
        },
        users: {
            inactive: 365, // Archive users inactive for 1 year
        },
    };

    // Clean up old coding sessions
    static async cleanupCodingSessions() {
        const now = new Date();
        const policies = this.retentionPolicies.codingSessions;

        // Delete sessions older than 90 days (but keep aggregated data)
        const detailedCutoff = new Date(
            now.getTime() - policies.detailed * 24 * 60 * 60 * 1000
        );

        try {
            console.log("🧹 Starting coding sessions cleanup...");

            // Get sessions to be deleted for aggregation
            const sessionsToAggregate = await CodingSession.find({
                sessionDate: { $lt: detailedCutoff },
                aggregated: { $ne: true },
            });

            console.log(
                `📊 Found ${sessionsToAggregate.length} sessions to aggregate`
            );

            // Aggregate sessions by user and date before deletion
            await this.aggregateSessionsBeforeCleanup(sessionsToAggregate);

            // Delete detailed sessions older than retention period
            const deleteResult = await CodingSession.deleteMany({
                sessionDate: { $lt: detailedCutoff },
                aggregated: { $ne: true },
            });

            console.log(
                `🗑️ Deleted ${deleteResult.deletedCount} old coding sessions`
            );
            return {
                aggregated: sessionsToAggregate.length,
                deleted: deleteResult.deletedCount,
            };
        } catch (error) {
            console.error("❌ Error during coding sessions cleanup:", error);
            throw error;
        }
    }

    // Aggregate sessions before cleanup
    static async aggregateSessionsBeforeCleanup(sessions) {
        const aggregationMap = new Map();

        // Group sessions by user and date
        sessions.forEach((session) => {
            const key = `${session.userId}_${
                session.sessionDate.toISOString().split("T")[0]
            }`;
            if (!aggregationMap.has(key)) {
                aggregationMap.set(key, {
                    userId: session.userId,
                    username: session.username,
                    sessionDate: session.sessionDate,
                    totalDuration: 0,
                    languages: {},
                    sessionCount: 0,
                });
            }

            const agg = aggregationMap.get(key);
            agg.totalDuration += session.duration;
            agg.sessionCount += 1;

            // Aggregate languages
            Object.entries(session.languages || {}).forEach(([lang, time]) => {
                agg.languages[lang] = (agg.languages[lang] || 0) + time;
            });
        });

        // Save aggregated data
        const AggregatedSession = require("./src/models/AggregatedSession.js");
        const aggregatedSessions = Array.from(aggregationMap.values()).map(
            (agg) => ({
                ...agg,
                aggregated: true,
                createdAt: new Date(),
            })
        );

        if (aggregatedSessions.length > 0) {
            await AggregatedSession.insertMany(aggregatedSessions);
            console.log(
                `📊 Created ${aggregatedSessions.length} aggregated session records`
            );
        }
    }

    // Clean up old leaderboard snapshots
    static async cleanupLeaderboardSnapshots() {
        const now = new Date();
        const policies = this.retentionPolicies.leaderboardSnapshots;

        try {
            console.log("🧹 Starting leaderboard snapshots cleanup...");
            let totalDeleted = 0;

            // Clean up daily snapshots
            if (policies.daily > 0) {
                const dailyCutoff = new Date(
                    now.getTime() - policies.daily * 24 * 60 * 60 * 1000
                );
                const dailyResult = await LeaderboardSnapshot.deleteMany({
                    timeframe: "day",
                    createdAt: { $lt: dailyCutoff },
                });
                totalDeleted += dailyResult.deletedCount;
                console.log(
                    `🗑️ Deleted ${dailyResult.deletedCount} old daily snapshots`
                );
            }

            // Clean up weekly snapshots
            if (policies.weekly > 0) {
                const weeklyCutoff = new Date(
                    now.getTime() - policies.weekly * 24 * 60 * 60 * 1000
                );
                const weeklyResult = await LeaderboardSnapshot.deleteMany({
                    timeframe: "week",
                    createdAt: { $lt: weeklyCutoff },
                });
                totalDeleted += weeklyResult.deletedCount;
                console.log(
                    `🗑️ Deleted ${weeklyResult.deletedCount} old weekly snapshots`
                );
            }

            // Clean up monthly snapshots
            if (policies.monthly > 0) {
                const monthlyCutoff = new Date(
                    now.getTime() - policies.monthly * 24 * 60 * 60 * 1000
                );
                const monthlyResult = await LeaderboardSnapshot.deleteMany({
                    timeframe: "month",
                    createdAt: { $lt: monthlyCutoff },
                });
                totalDeleted += monthlyResult.deletedCount;
                console.log(
                    `🗑️ Deleted ${monthlyResult.deletedCount} old monthly snapshots`
                );
            }

            // Note: allTime snapshots are kept forever (policies.allTime = -1)

            return { deletedCount: totalDeleted };
        } catch (error) {
            console.error(
                "❌ Error during leaderboard snapshots cleanup:",
                error
            );
            throw error;
        }
    }

    // Archive inactive users
    static async archiveInactiveUsers() {
        const now = new Date();
        const inactiveCutoff = new Date(
            now.getTime() -
                this.retentionPolicies.users.inactive * 24 * 60 * 60 * 1000
        );

        try {
            console.log("🧹 Starting inactive users archival...");

            // Find users who haven't had a session in the retention period
            const inactiveUsers = await User.find({
                lastSessionDate: { $lt: inactiveCutoff },
            });

            console.log(
                `📦 Found ${inactiveUsers.length} inactive users to archive`
            );

            // Mark users as archived instead of deleting
            const archiveResult = await User.updateMany(
                { lastSessionDate: { $lt: inactiveCutoff } },
                {
                    $set: {
                        archived: true,
                        archivedAt: new Date(),
                    },
                }
            );

            console.log(
                `📦 Archived ${archiveResult.modifiedCount} inactive users`
            );
            return { archivedCount: archiveResult.modifiedCount };
        } catch (error) {
            console.error("❌ Error during inactive users archival:", error);
            throw error;
        }
    }

    // Run full cleanup process
    static async runFullCleanup() {
        console.log("🧹 Starting full database cleanup...");
        const results = {};

        try {
            results.codingSessions = await this.cleanupCodingSessions();
            results.leaderboardSnapshots =
                await this.cleanupLeaderboardSnapshots();
            results.inactiveUsers = await this.archiveInactiveUsers();

            console.log("✅ Full cleanup completed:", results);
            return results;
        } catch (error) {
            console.error("❌ Full cleanup failed:", error);
            throw error;
        }
    }

    // Get database size statistics
    static async getDatabaseStats() {
        try {
            const stats = {
                codingSessions: await CodingSession.countDocuments(),
                leaderboardSnapshots:
                    await LeaderboardSnapshot.countDocuments(),
                users: await User.countDocuments(),
                archivedUsers: await User.countDocuments({ archived: true }),
                oldestSession: await CodingSession.findOne().sort({
                    sessionDate: 1,
                }),
                newestSession: await CodingSession.findOne().sort({
                    sessionDate: -1,
                }),
            };

            // Calculate approximate storage usage
            const avgSessionSize = 0.5; // KB per session (estimate)
            const avgSnapshotSize = 2; // KB per snapshot (estimate)

            stats.estimatedStorageKB =
                stats.codingSessions * avgSessionSize +
                stats.leaderboardSnapshots * avgSnapshotSize;

            return stats;
        } catch (error) {
            console.error("❌ Error getting database stats:", error);
            throw error;
        }
    }
}

module.exports = DataRetentionService;
