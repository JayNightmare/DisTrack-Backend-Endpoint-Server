// React component example for displaying leaderboard with trends

import React, { useState, useEffect } from "react";

const LeaderboardWithTrends = ({ timeframe = "allTime", limit = 10 }) => {
    const [leaderboard, setLeaderboard] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    const API_BASE_URL = "http://localhost:7071"; // Replace with your server URL
    const API_KEY = "your-api-key"; // Replace with your API key

    useEffect(() => {
        fetchLeaderboard();
    }, [timeframe, limit]);

    const fetchLeaderboard = async () => {
        setLoading(true);
        setError(null);

        try {
            const response = await fetch(
                `${API_BASE_URL}/leaderboard/${timeframe}?limit=${limit}`,
                {
                    headers: {
                        Authorization: `Bearer ${API_KEY}`,
                        "Content-Type": "application/json",
                    },
                }
            );

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const data = await response.json();
            setLeaderboard(data.leaderboard || []);
        } catch (err) {
            setError(`Failed to fetch leaderboard: ${err.message}`);
            console.error("Error fetching leaderboard:", err);
        } finally {
            setLoading(false);
        }
    };

    const getTrendIcon = (rankDelta) => {
        if (rankDelta > 0)
            return { icon: "↗️", color: "green", text: `+${rankDelta}` };
        if (rankDelta < 0) return { icon: "↘️", color: "red", text: rankDelta };
        return { icon: "➡️", color: "gray", text: "0" };
    };

    const formatTime = (seconds) => {
        const hours = Math.floor(seconds / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        return `${hours}h ${minutes}m`;
    };

    const getTimeframeLabel = (timeframe) => {
        const labels = {
            day: "Today",
            week: "This Week",
            month: "This Month",
            allTime: "All Time",
        };
        return labels[timeframe] || timeframe;
    };

    if (loading) {
        return (
            <div className="leaderboard-container">
                <div className="loading">Loading leaderboard...</div>
            </div>
        );
    }

    if (error) {
        return (
            <div className="leaderboard-container">
                <div className="error">
                    {error}
                    <button
                        onClick={fetchLeaderboard}
                        style={{ marginLeft: "10px" }}
                    >
                        Retry
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div className="leaderboard-container">
            <h2>🏆 Coding Leaderboard - {getTimeframeLabel(timeframe)}</h2>

            <div className="timeframe-selector">
                {["day", "week", "month", "allTime"].map((tf) => (
                    <button
                        key={tf}
                        onClick={() => setTimeframe(tf)}
                        className={timeframe === tf ? "active" : ""}
                        style={{
                            margin: "0 5px",
                            padding: "5px 10px",
                            backgroundColor:
                                timeframe === tf ? "#007acc" : "#f0f0f0",
                            color: timeframe === tf ? "white" : "black",
                            border: "none",
                            borderRadius: "4px",
                            cursor: "pointer",
                        }}
                    >
                        {getTimeframeLabel(tf)}
                    </button>
                ))}
            </div>

            {leaderboard.length === 0 ? (
                <div className="no-data">
                    No data available for this timeframe
                </div>
            ) : (
                <div className="leaderboard-list">
                    {leaderboard.map((user, index) => {
                        const trend = getTrendIcon(user.rankDelta);
                        const isCurrentUser = false; // You can implement user identification logic here

                        return (
                            <div
                                key={user.userId}
                                className={`leaderboard-item ${
                                    isCurrentUser ? "current-user" : ""
                                }`}
                                style={{
                                    display: "flex",
                                    alignItems: "center",
                                    padding: "10px",
                                    margin: "5px 0",
                                    backgroundColor: isCurrentUser
                                        ? "#e6f3ff"
                                        : "#f9f9f9",
                                    borderRadius: "8px",
                                    border: isCurrentUser
                                        ? "2px solid #007acc"
                                        : "1px solid #ddd",
                                }}
                            >
                                <div
                                    className="rank"
                                    style={{
                                        fontSize: "18px",
                                        fontWeight: "bold",
                                        width: "40px",
                                    }}
                                >
                                    #{user.rank}
                                </div>

                                <div
                                    className="user-info"
                                    style={{ flex: 1, marginLeft: "10px" }}
                                >
                                    <div
                                        className="username"
                                        style={{ fontWeight: "bold" }}
                                    >
                                        {user.username}
                                    </div>
                                    <div
                                        className="coding-time"
                                        style={{
                                            color: "#666",
                                            fontSize: "14px",
                                        }}
                                    >
                                        {formatTime(user.totalTime)}
                                    </div>
                                </div>

                                <div
                                    className="trend"
                                    style={{
                                        display: "flex",
                                        alignItems: "center",
                                        gap: "5px",
                                    }}
                                >
                                    <span style={{ fontSize: "20px" }}>
                                        {trend.icon}
                                    </span>
                                    <span
                                        style={{
                                            color: trend.color,
                                            fontWeight: "bold",
                                            fontSize: "14px",
                                        }}
                                    >
                                        {trend.text}
                                    </span>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}

            <div
                className="leaderboard-footer"
                style={{ marginTop: "20px", fontSize: "12px", color: "#666" }}
            >
                <p>
                    Trend indicators show rank changes since the last snapshot:
                    ↗️ Moved up | ↘️ Moved down | ➡️ No change
                </p>
                <button
                    onClick={fetchLeaderboard}
                    style={{
                        padding: "5px 10px",
                        backgroundColor: "#28a745",
                        color: "white",
                        border: "none",
                        borderRadius: "4px",
                        cursor: "pointer",
                    }}
                >
                    🔄 Refresh
                </button>
            </div>
        </div>
    );
};

export default LeaderboardWithTrends;

// Usage example:
// <LeaderboardWithTrends timeframe="week" limit={15} />
