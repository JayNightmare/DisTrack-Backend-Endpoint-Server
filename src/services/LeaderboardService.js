const User = require("../models/User.js");
const LeaderboardSnapshot = require("../models/LeaderboardSnapshot.js");
const CodingSession = require("../models/CodingSession.js");

class LeaderboardService {
    /**
     * Calculate total coding time for a specific timeframe
     * @param {Object} user - User document from MongoDB
     * @param {string} timeframe - "day", "week", "month", or "allTime"
     * @param {Date} referenceDate - Date to calculate from (defaults to today)
     * @returns {number} Total coding time in seconds for the timeframe
     */
    static async getTimeframeTotal(
        user,
        timeframe,
        referenceDate = new Date()
    ) {
        switch (timeframe) {
            case "allTime":
                return user.totalCodingTime || 0;

            case "day":
                return await this._getDayTotal(user, referenceDate);

            case "week":
                return await this._getWeekTotal(user, referenceDate);

            case "month":
                return await this._getMonthTotal(user, referenceDate);

            default:
                throw new Error(`Invalid timeframe: ${timeframe}`);
        }
    }

    /**
     * Calculate daily total from session data
     */
    static async _getDayTotal(user, referenceDate) {
        try {
            return await CodingSession.getTotalTimeForTimeframe(
                user.userId,
                "day",
                referenceDate
            );
        } catch (error) {
            console.error(
                `Error calculating day total for user ${user.userId}:`,
                error
            );
            // Fallback to placeholder logic if session data isn't available
            const today = new Date(referenceDate);
            const lastSession = user.lastSessionDate
                ? new Date(user.lastSessionDate)
                : null;

            if (lastSession && this._isSameDay(today, lastSession)) {
                return Math.min(user.totalCodingTime, 3600); // Max 1 hour for demo
            }
            return 0;
        }
    }

    /**
     * Calculate weekly total from session data
     */
    static async _getWeekTotal(user, referenceDate) {
        try {
            return await CodingSession.getTotalTimeForTimeframe(
                user.userId,
                "week",
                referenceDate
            );
        } catch (error) {
            console.error(
                `Error calculating week total for user ${user.userId}:`,
                error
            );
            // Fallback: return 30% of total time
            return Math.floor((user.totalCodingTime || 0) * 0.3);
        }
    }

    /**
     * Calculate monthly total from session data
     */
    static async _getMonthTotal(user, referenceDate) {
        try {
            return await CodingSession.getTotalTimeForTimeframe(
                user.userId,
                "month",
                referenceDate
            );
        } catch (error) {
            console.error(
                `Error calculating month total for user ${user.userId}:`,
                error
            );
            // Fallback: return 70% of total time
            return Math.floor((user.totalCodingTime || 0) * 0.7);
        }
    }

    /**
     * Check if two dates are the same day
     */
    static _isSameDay(date1, date2) {
        return (
            date1.getFullYear() === date2.getFullYear() &&
            date1.getMonth() === date2.getMonth() &&
            date1.getDate() === date2.getDate()
        );
    }

    /**
     * Take a snapshot of the leaderboard for a specific timeframe
     * @param {string} timeframe - "day", "week", "month", or "allTime"
     * @param {Date} snapshotDate - Date of the snapshot (defaults to now)
     * @returns {Promise<Object>} Result with success status and message
     */
    static async takeSnapshot(timeframe, snapshotDate = new Date()) {
        try {
            console.log(
                `Taking ${timeframe} leaderboard snapshot for ${snapshotDate.toISOString()}`
            );

            // Check if snapshot already exists for this date and timeframe
            const exists = await LeaderboardSnapshot.snapshotExistsForDate(
                timeframe,
                snapshotDate
            );
            if (exists) {
                console.log(
                    `Snapshot already exists for ${timeframe} on ${snapshotDate.toDateString()}`
                );
                return {
                    success: false,
                    message: `Snapshot already exists for ${timeframe} on ${snapshotDate.toDateString()}`,
                };
            }

            // Fetch all users
            const users = await User.find({}).lean();
            console.log(`Found ${users.length} users for snapshot`);

            if (users.length === 0) {
                return {
                    success: false,
                    message: "No users found for snapshot",
                };
            }

            // Calculate timeframe totals and prepare leaderboard data
            const leaderboardData = await Promise.all(
                users.map(async (user) => ({
                    userId: user.userId,
                    username: user.username || "Anonymous",
                    totalTime: await this.getTimeframeTotal(
                        user,
                        timeframe,
                        snapshotDate
                    ),
                }))
            );

            // Sort by total time descending to determine ranks
            leaderboardData.sort((a, b) => b.totalTime - a.totalTime);

            // Create snapshot documents with ranks
            const snapshots = leaderboardData.map((user, index) => ({
                userId: user.userId,
                username: user.username,
                timeframe: timeframe,
                timestamp: snapshotDate,
                rank: index + 1, // Rank starts at 1
                totalTime: user.totalTime,
            }));

            // Save all snapshots in batch for better performance
            await LeaderboardSnapshot.insertMany(snapshots);

            console.log(
                `Successfully created ${snapshots.length} snapshot records for ${timeframe}`
            );

            return {
                success: true,
                message: `Successfully created ${snapshots.length} snapshot records for ${timeframe}`,
                snapshotCount: snapshots.length,
            };
        } catch (error) {
            console.error(`Error taking ${timeframe} snapshot:`, error);
            return {
                success: false,
                message: `Error taking ${timeframe} snapshot: ${error.message}`,
                error: error,
            };
        }
    }

    /**
     * Get current leaderboard with rank deltas compared to previous snapshot
     * @param {string} timeframe - "day", "week", "month", or "allTime"
     * @param {number} limit - Number of top users to return (default: 10)
     * @returns {Promise<Array>} Leaderboard with rank deltas
     */
    static async getLeaderboardWithTrends(timeframe, limit = 50) {
        try {
            console.log(
                `Getting ${timeframe} leaderboard with trends (limit: ${limit})`
            );

            // Fetch all users
            const users = await User.find({}).lean();

            if (users.length === 0) {
                return [];
            }

            // Calculate current leaderboard
            const currentLeaderboard = await Promise.all(
                users.map(async (user) => ({
                    userId: user.userId,
                    username: user.username || "Anonymous",
                    displayName:
                        user.displayName || user.username || "Anonymous",
                    totalTime: await this.getTimeframeTotal(user, timeframe),
                }))
            );

            // Sort by total time descending to get current ranks
            currentLeaderboard.sort((a, b) => b.totalTime - a.totalTime);

            // Add current ranks
            currentLeaderboard.forEach((user, index) => {
                user.rank = index + 1;
            });

            // Get the latest previous snapshot for comparison
            const latestSnapshot = await LeaderboardSnapshot.findOne({
                timeframe: timeframe,
            })
                .sort({ timestamp: -1 })
                .lean();

            let previousRanks = {};

            if (latestSnapshot) {
                // Get all snapshots from the same timestamp as the latest one
                const previousSnapshots = await LeaderboardSnapshot.find({
                    timeframe: timeframe,
                    timestamp: latestSnapshot.timestamp,
                }).lean();

                // Create a map of userId to previous rank
                previousSnapshots.forEach((snapshot) => {
                    previousRanks[snapshot.userId] = snapshot.rank;
                });

                console.log(
                    `Found previous snapshot from ${latestSnapshot.timestamp} with ${previousSnapshots.length} entries`
                );
            } else {
                console.log(`No previous snapshot found for ${timeframe}`);
            }

            // Calculate rank deltas and prepare final leaderboard
            const leaderboardWithTrends = currentLeaderboard
                .slice(0, limit)
                .map((user) => {
                    const previousRank = previousRanks[user.userId];
                    let rankDelta = 0;

                    if (previousRank !== undefined) {
                        // Positive delta means moved up (lower rank number)
                        // Negative delta means moved down (higher rank number)
                        rankDelta = previousRank - user.rank;
                    }

                    return {
                        userId: user.userId,
                        username: user.username,
                        displayName: user.displayName,
                        rank: user.rank,
                        totalTime: user.totalTime,
                        rankDelta: rankDelta,
                        previousRank: previousRank || null,
                    };
                });

            console.log(
                `Generated leaderboard with ${leaderboardWithTrends.length} entries`
            );

            return leaderboardWithTrends;
        } catch (error) {
            console.error(
                `Error getting ${timeframe} leaderboard with trends:`,
                error
            );
            throw error;
        }
    }

    /**
     * Get user's rank history for a specific timeframe
     * @param {string} userId - User ID
     * @param {string} timeframe - "day", "week", "month", or "allTime"
     * @param {number} limit - Number of historical records to return
     * @returns {Promise<Array>} User's rank history
     */
    static async getUserRankHistory(userId, timeframe, limit = 30) {
        try {
            const history = await LeaderboardSnapshot.find({
                userId: userId,
                timeframe: timeframe,
            })
                .sort({ timestamp: -1 })
                .limit(limit)
                .lean();

            return history.map((snapshot) => ({
                timestamp: snapshot.timestamp,
                rank: snapshot.rank,
                totalTime: snapshot.totalTime,
            }));
        } catch (error) {
            console.error(
                `Error getting rank history for user ${userId}:`,
                error
            );
            throw error;
        }
    }

    /**
     * Schedule snapshot taking for all timeframes
     * This can be called by a cron job or scheduled task
     * @param {Date} snapshotDate - Date for the snapshot (defaults to now)
     * @returns {Promise<Object>} Results for all timeframes
     */
    static async takeAllSnapshots(snapshotDate = new Date()) {
        const timeframes = ["day", "week", "month", "allTime"];
        const results = {};

        console.log(
            `Taking snapshots for all timeframes on ${snapshotDate.toISOString()}`
        );

        for (const timeframe of timeframes) {
            try {
                results[timeframe] = await this.takeSnapshot(
                    timeframe,
                    snapshotDate
                );
            } catch (error) {
                console.error(`Failed to take ${timeframe} snapshot:`, error);
                results[timeframe] = {
                    success: false,
                    message: `Failed to take ${timeframe} snapshot: ${error.message}`,
                    error: error,
                };
            }
        }

        return results;
    }
}

module.exports = LeaderboardService;
