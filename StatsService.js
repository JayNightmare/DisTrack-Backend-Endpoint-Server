const User = require("./User.js");
const CodingSession = require("./CodingSession.js");

// ---------------- Helper date utilities ---------------- //
function startOfDay(d) {
    const x = new Date(d);
    x.setHours(0, 0, 0, 0);
    return x;
}

function endOfDay(d) {
    const x = new Date(d);
    x.setHours(23, 59, 59, 999);
    return x;
}

function addDays(d, n) {
    const x = new Date(d);
    x.setDate(x.getDate() + n);
    return x;
}

function dateKeyYYYYMMDD(d) {
    const x = new Date(d);
    const y = x.getFullYear();
    const m = String(x.getMonth() + 1).padStart(2, "0");
    const da = String(x.getDate()).padStart(2, "0");
    return `${y}-${m}-${da}`;
}

// ISO week helpers
function getISOWeekYear(date) {
    const tmp = new Date(date);
    tmp.setHours(0, 0, 0, 0);
    // Thursday in current week decides the year.
    tmp.setDate(tmp.getDate() + 3 - ((tmp.getDay() + 6) % 7));
    return tmp.getFullYear();
}

function getISOWeekNumber(date) {
    const tmp = new Date(date);
    tmp.setHours(0, 0, 0, 0);
    // Thursday in current week decides the year.
    tmp.setDate(tmp.getDate() + 3 - ((tmp.getDay() + 6) % 7));
    // January 4 is always in week 1.
    const week1 = new Date(tmp.getFullYear(), 0, 4);
    // Adjust to Thursday in week 1 and count number of weeks from date to week1.
    return (
        1 +
        Math.round(
            ((tmp.getTime() - week1.getTime()) / 86400000 -
                3 +
                ((week1.getDay() + 6) % 7)) /
                7
        )
    );
}

function getISOWeekStartDate(isoYear, isoWeek) {
    // January 4th is always in week 1
    const jan4 = new Date(isoYear, 0, 4);
    const dayOfWeek = (jan4.getDay() + 6) % 7; // 0 = Monday
    const week1Monday = new Date(jan4);
    week1Monday.setDate(jan4.getDate() - dayOfWeek);
    const weekStart = new Date(week1Monday);
    weekStart.setDate(week1Monday.getDate() + (isoWeek - 1) * 7);
    weekStart.setHours(0, 0, 0, 0);
    return weekStart;
}

function enumerateDaysInclusive(start, end) {
    const out = [];
    let cur = startOfDay(start);
    const last = endOfDay(end);
    while (cur <= last) {
        out.push(new Date(cur));
        cur = addDays(cur, 1);
    }
    return out;
}

// ---------------- Core service ---------------- //
const StatsService = {
    // Global platform stats
    async getGlobalStats(options = {}) {
        const now = new Date();
        const weeksBack = options.weeksBack || 12;
        const weekWindowStart = addDays(now, -7 * weeksBack);

        // Users and sessions
        const [
            totalUsers,
            totalSessions,
            active7,
            active30,
            extensionLinkedCount,
            weeklyAgg,
        ] = await Promise.all([
            User.countDocuments({ archived: { $ne: true } }),
            CodingSession.countDocuments({}),
            CodingSession.distinct("userId", {
                sessionDate: { $gte: addDays(now, -7) },
            }).then((ids) => ids.length),
            CodingSession.distinct("userId", {
                sessionDate: { $gte: addDays(now, -30) },
            }).then((ids) => ids.length),
            User.countDocuments({ extensionLinked: true }),
            // Weekly totals for the last N weeks
            CodingSession.aggregate([
                { $match: { sessionDate: { $gte: weekWindowStart } } },
                {
                    $group: {
                        _id: {
                            y: { $isoWeekYear: "$sessionDate" },
                            w: { $isoWeek: "$sessionDate" },
                        },
                        seconds: { $sum: "$duration" },
                    },
                },
                { $sort: { "_id.y": 1, "_id.w": 1 } },
            ]).then((rows) =>
                rows.map((r) => ({
                    year: r._id.y,
                    week: r._id.w,
                    weekStart: getISOWeekStartDate(r._id.y, r._id.w),
                    totalHours: +(r.seconds / 3600).toFixed(2),
                }))
            ),
        ]);

        return {
            totals: {
                users: totalUsers,
                sessions: totalSessions,
                activeUsers: { last7Days: active7, last30Days: active30 },
            },
            weeklyActivity: weeklyAgg,
            extension: {
                // Count of users who have linked extension (proxy for active installs)
                linkedUsers: extensionLinkedCount,
                // Marketplace downloads not tracked here; integrate later if needed
                marketplaceDownloads: null,
            },
        };
    },

    // User-focused analytics over a time filter
    async getUserFilterStats(userId, options = {}) {
        if (!userId) throw new Error("userId is required");
        const end = options.endDate ? new Date(options.endDate) : new Date();
        const start = options.startDate
            ? startOfDay(new Date(options.startDate))
            : addDays(end, -30); // default last 30 days

        const sessions = await CodingSession.find({
            userId,
            startTime: { $gte: start, $lt: end },
        })
            .sort({ startTime: 1 })
            .lean();

        const sessionsCount = sessions.length;
        const totalSeconds = sessions.reduce(
            (a, s) => a + (s.duration || 0),
            0
        );

        // Hourly histogram split by weekdays/weekends
        const weekdays = Array(24).fill(0);
        const weekends = Array(24).fill(0);
        const dailyMap = new Map(); // key: YYYY-MM-DD -> { seconds, sessions }

        let longFocusSeconds = 0;
        const LONG_FOCUS_THRESHOLD_SEC = 25 * 60; // 25 minutes

        for (const s of sessions) {
            const dt = new Date(s.startTime);
            const hour = dt.getHours();
            const dow = dt.getDay(); // 0=Sun,6=Sat
            const isWeekend = dow === 0 || dow === 6;
            const dur = s.duration || 0;
            if (isWeekend) weekends[hour] += dur;
            else weekdays[hour] += dur;

            const k = dateKeyYYYYMMDD(s.sessionDate || s.startTime);
            const entry = dailyMap.get(k) || { seconds: 0, sessions: 0 };
            entry.seconds += dur;
            entry.sessions += 1;
            dailyMap.set(k, entry);

            if (dur >= LONG_FOCUS_THRESHOLD_SEC) longFocusSeconds += dur;
        }

        // Normalize to include every day in range
        const allDays = enumerateDaysInclusive(start, endOfDay(end));
        const dailySeries = allDays.map((d) => {
            const k = dateKeyYYYYMMDD(d);
            const e = dailyMap.get(k) || { seconds: 0, sessions: 0 };
            return {
                date: k,
                totalHours: +(e.seconds / 3600).toFixed(2),
                sessions: e.sessions,
            };
        });

        // Moving averages
        function movingAverage(series, window) {
            const out = [];
            let sum = 0;
            const q = [];
            for (let i = 0; i < series.length; i++) {
                const v = series[i].totalHours;
                sum += v;
                q.push(v);
                if (q.length > window) sum -= q.shift();
                const avg = q.length ? sum / q.length : 0;
                out.push({ date: series[i].date, hours: +avg.toFixed(2) });
            }
            return out;
        }

        const ma7 = movingAverage(dailySeries, 7);
        const ma30 = movingAverage(dailySeries, 30);

        // Anomalies (compare to MA7)
        const spikes = [];
        const drops = [];
        for (let i = 0; i < dailySeries.length; i++) {
            const v = dailySeries[i].totalHours;
            const baseline = ma7[i].hours;
            if (baseline > 0) {
                const ratio = v / baseline;
                if (ratio >= 1.8 && v >= 1)
                    spikes.push({
                        date: dailySeries[i].date,
                        hours: v,
                        ratio: +ratio.toFixed(2),
                    });
                else if (ratio <= 0.3 && baseline >= 1)
                    drops.push({
                        date: dailySeries[i].date,
                        hours: v,
                        ratio: +ratio.toFixed(2),
                    });
            }
        }

        // Week-over-week trends
        const weeklyBuckets = new Map(); // key: yyyy-w -> seconds
        for (const d of allDays) {
            const y = getISOWeekYear(d);
            const w = getISOWeekNumber(d);
            const key = `${y}-${String(w).padStart(2, "0")}`;
            const k = dateKeyYYYYMMDD(d);
            const e = dailyMap.get(k) || { seconds: 0 };
            weeklyBuckets.set(key, (weeklyBuckets.get(key) || 0) + e.seconds);
        }
        const weeklySeries = Array.from(weeklyBuckets.entries())
            .map(([key, sec]) => {
                const [yy, ww] = key.split("-").map((z) => parseInt(z, 10));
                return {
                    year: yy,
                    week: ww,
                    weekStart: getISOWeekStartDate(yy, ww),
                    totalHours: +(sec / 3600).toFixed(2),
                    key,
                };
            })
            .sort((a, b) => a.year - b.year || a.week - b.week);
        const weekOverWeek = [];
        for (let i = 1; i < weeklySeries.length; i++) {
            const prev = weeklySeries[i - 1].totalHours;
            const cur = weeklySeries[i].totalHours;
            const pct = prev > 0 ? ((cur - prev) / prev) * 100 : 0;
            weekOverWeek.push({
                weekKey: `${weeklySeries[i].year}-${String(
                    weeklySeries[i].week
                ).padStart(2, "0")}`,
                pctChange: +pct.toFixed(1),
            });
        }

        // Deep-work days: total >= 3h and sessions <= 3
        const DEEP_WORK_HOURS = 3;
        const deepWorkDays = dailySeries
            .filter((d) => d.totalHours >= DEEP_WORK_HOURS && d.sessions <= 3)
            .map((d) => d.date);

        const avgSessionMinutes = sessionsCount
            ? totalSeconds / sessionsCount / 60
            : 0;
        const distinctDays = dailySeries.length || 1;
        const contextSwitchesPerDay = sessionsCount / distinctDays;
        const focusRatio =
            totalSeconds > 0 ? longFocusSeconds / totalSeconds : 0;

        return {
            range: { start: start, end: end },
            summary: {
                sessionsCount,
                totalHours: +(totalSeconds / 3600).toFixed(2),
                averageSessionMinutes: +avgSessionMinutes.toFixed(1),
                focusRatio: +focusRatio.toFixed(3),
                contextSwitchesPerDay: +contextSwitchesPerDay.toFixed(2),
            },
            hourlyPatterns: {
                weekdays: weekdays.map((s) => +(s / 3600).toFixed(2)),
                weekends: weekends.map((s) => +(s / 3600).toFixed(2)),
            },
            daily: {
                series: dailySeries,
                movingAverages: { ma7, ma30 },
                anomalies: { spikes, drops },
                deepWorkDays,
            },
            weekly: {
                series: weeklySeries,
                weekOverWeek,
            },
        };
    },

    // Language / tech breakdown over time, plus current totals
    async getUserLanguageStats(userId, options = {}) {
        if (!userId) throw new Error("userId is required");
        const end = options.endDate ? new Date(options.endDate) : new Date();
        const start = options.startDate
            ? startOfDay(new Date(options.startDate))
            : addDays(end, -90); // default last 90 days
        const topN = options.topN || 6;

        const sessions = await CodingSession.find({
            userId,
            startTime: { $gte: start, $lt: end },
        })
            .sort({ startTime: 1 })
            .lean();

        // Aggregate current totals and per-day series
        const totalByLang = new Map();
        const perDay = new Map(); // key date -> Map<lang, seconds>

        for (const s of sessions) {
            const langs = s.languages || {};
            const dayKey = dateKeyYYYYMMDD(s.sessionDate || s.startTime);
            const dayMap = perDay.get(dayKey) || new Map();
            for (const [lang, sec] of Object.entries(langs)) {
                if (!sec || typeof sec !== "number") continue;
                totalByLang.set(lang, (totalByLang.get(lang) || 0) + sec);
                dayMap.set(lang, (dayMap.get(lang) || 0) + sec);
            }
            perDay.set(dayKey, dayMap);
        }

        // Determine top languages
        const totalsSorted = Array.from(totalByLang.entries()).sort(
            (a, b) => b[1] - a[1]
        );
        const topLangs = totalsSorted.slice(0, topN).map(([l]) => l);

        // Build stacked series with others collapsed
        const allDays = enumerateDaysInclusive(start, endOfDay(end));
        const series = allDays.map((d) => {
            const k = dateKeyYYYYMMDD(d);
            const m = perDay.get(k) || new Map();
            const entry = { date: k, languages: {} };
            let other = 0;
            for (const [lang, sec] of m.entries()) {
                if (topLangs.includes(lang)) {
                    entry.languages[lang] = +(sec / 3600).toFixed(2);
                } else {
                    other += sec;
                }
            }
            if (other > 0) entry.languages.other = +(other / 3600).toFixed(2);
            // Ensure topLangs keys exist
            for (const l of topLangs)
                if (!(l in entry.languages)) entry.languages[l] = 0;
            return entry;
        });

        const currentTotals = Object.fromEntries(
            totalsSorted.map(([l, s]) => [l, +(s / 3600).toFixed(2)])
        );

        return {
            range: { start, end },
            topLanguages: topLangs,
            timeseries: series,
            totals: currentTotals, // hours per language
        };
    },

    // Calendar heatmap style: totals per day in a given year
    async getUserHeatmapStats(userId, options = {}) {
        if (!userId) throw new Error("userId is required");
        const year = options.year || new Date().getFullYear();
        const start = new Date(year, 0, 1);
        const end = new Date(year, 11, 31, 23, 59, 59, 999);

        const rows = await CodingSession.aggregate([
            {
                $match: {
                    userId,
                    sessionDate: { $gte: start, $lte: end },
                },
            },
            {
                $group: {
                    _id: "$sessionDate",
                    seconds: { $sum: "$duration" },
                    sessions: { $sum: 1 },
                },
            },
            { $sort: { _id: 1 } },
        ]);

        const byDate = {};
        let totalSeconds = 0;
        for (const r of rows) {
            const k = dateKeyYYYYMMDD(r._id);
            byDate[k] = r.seconds;
            totalSeconds += r.seconds;
        }

        return {
            year,
            totalHours: +(totalSeconds / 3600).toFixed(2),
            days: byDate, // { 'YYYY-MM-DD': seconds }
        };
    },

    // ---------------- Global live/trends/heatmap/growth ---------------- //

    // Live counters for homepage
    async getGlobalLive() {
        const now = new Date();
        const startToday = startOfDay(now);
        const endToday = endOfDay(now);
        const onlineWindowMs = 10 * 60 * 1000; // 10 minutes
        const onlineSince = new Date(now.getTime() - onlineWindowMs);

        const [totalUsersSum, sessionsToday, usersOnlineDistinct] =
            await Promise.all([
                // Sum totalCodingTime across users (seconds)
                User.aggregate([
                    {
                        $group: {
                            _id: null,
                            seconds: { $sum: "$totalCodingTime" },
                        },
                    },
                ]).then((r) => r[0]?.seconds || 0),
                CodingSession.find(
                    { sessionDate: { $gte: startToday, $lte: endToday } },
                    { duration: 1, languages: 1 }
                ).lean(),
                CodingSession.distinct("userId", {
                    endTime: { $gte: onlineSince },
                }),
            ]);

        let totalSecToday = 0;
        let topLang = null;
        let avgSessionMin = 0;

        if (sessionsToday.length > 0) {
            const langTotals = {};
            for (const s of sessionsToday) {
                totalSecToday += s.duration || 0;
                const langs = s.languages || {};
                for (const [k, v] of Object.entries(langs)) {
                    if (!v || typeof v !== "number") continue;
                    langTotals[k] = (langTotals[k] || 0) + v;
                }
            }
            const top = Object.entries(langTotals).sort(
                (a, b) => b[1] - a[1]
            )[0];
            topLang = top ? top[0] : null;
            avgSessionMin = totalSecToday / sessionsToday.length / 60;
        }

        return {
            totalHoursTracked: +((totalUsersSum || 0) / 3600).toFixed(2),
            usersOnline: usersOnlineDistinct.length || 0,
            sessionsToday: sessionsToday.length || 0,
            topLanguageToday: topLang,
            avgSessionMinutes: +avgSessionMin.toFixed(1),
        };
    },

    // 7-day or N-day rolling trends for mini-cards
    async getGlobalTrends(days = 7) {
        const now = new Date();
        const start = startOfDay(addDays(now, -(days - 1)));

        // Aggregate per day totals and active users
        const rows = await CodingSession.aggregate([
            { $match: { sessionDate: { $gte: start, $lte: endOfDay(now) } } },
            {
                $group: {
                    _id: "$sessionDate",
                    seconds: { $sum: "$duration" },
                    users: { $addToSet: "$userId" },
                },
            },
            {
                $project: {
                    _id: 1,
                    seconds: 1,
                    activeUsers: { $size: "$users" },
                    users: 1,
                },
            },
            { $sort: { _id: 1 } },
        ]);

        // Build day map and union of users
        const byDate = new Map();
        const unionUsers = new Set();
        for (const r of rows) {
            const k = dateKeyYYYYMMDD(r._id);
            byDate.set(k, {
                seconds: r.seconds,
                activeUsers: r.activeUsers,
                users: r.users,
            });
            for (const u of r.users) unionUsers.add(u);
        }

        // Load current streaks for users (approximation for each day)
        const userList = Array.from(unionUsers);
        const streakMap = new Map();
        if (userList.length > 0) {
            const userDocs = await User.find(
                { userId: { $in: userList } },
                { userId: 1, currentStreak: 1 }
            ).lean();
            for (const u of userDocs)
                streakMap.set(u.userId, u.currentStreak || 0);
        }

        const allDays = enumerateDaysInclusive(start, now);
        const hoursTracked = [];
        const activeUsers = [];
        const avgStreak = [];
        for (const d of allDays) {
            const k = dateKeyYYYYMMDD(d);
            const e = byDate.get(k);
            const sec = e?.seconds || 0;
            const au = e?.activeUsers || 0;
            hoursTracked.push(+(sec / 3600).toFixed(2));
            activeUsers.push(au);
            if (e?.users?.length) {
                const sum = e.users.reduce(
                    (acc, uid) => acc + (streakMap.get(uid) || 0),
                    0
                );
                avgStreak.push(+(sum / e.users.length).toFixed(1));
            } else {
                avgStreak.push(0);
            }
        }

        return { hoursTracked, activeUsers, avgStreak };
    },

    // Hour heatmap for last N days (UTC)
    async getGlobalHourlyHeatmap(windowDays = 30) {
        const now = new Date();
        const start = addDays(now, -windowDays);
        const rows = await CodingSession.aggregate([
            { $match: { startTime: { $gte: start } } },
            {
                $group: {
                    _id: {
                        d: {
                            $dayOfWeek: { date: "$startTime", timezone: "UTC" },
                        }, // 1(Sun)-7(Sat)
                        h: { $hour: { date: "$startTime", timezone: "UTC" } },
                    },
                    seconds: { $sum: "$duration" },
                },
            },
            {
                $project: {
                    dayOfWeek: { $subtract: ["$_id.d", 1] },
                    hour: "$_id.h",
                    seconds: 1,
                },
            },
        ]);

        // Initialize 7x24 matrix (Sun=0..Sat=6)
        const matrix = Array.from({ length: 7 }, () => Array(24).fill(0));
        for (const r of rows) {
            const d = Math.max(0, Math.min(6, r.dayOfWeek));
            const h = Math.max(0, Math.min(23, r.hour));
            matrix[d][h] = (matrix[d][h] || 0) + (r.seconds || 0);
        }
        return { matrix };
    },

    // Language growth over periods across the platform
    async getLanguageGrowth(period = "week", limit = 10) {
        const now = new Date();
        let days = 7;
        if (typeof period === "string") {
            switch (period.toLowerCase()) {
                case "day":
                case "1d":
                    days = 1;
                    break;
                case "week":
                case "7d":
                    days = 7;
                    break;
                case "month":
                case "30d":
                    days = 30;
                    break;
                default:
                    days = 7;
            }
        }
        const startCurrent = startOfDay(addDays(now, -days + 1));
        const endCurrent = now;
        const startPrev = startOfDay(addDays(startCurrent, -days));
        const endPrev = addDays(startCurrent, -1);

        const languageKeys = [
            "javascript",
            "html",
            "css",
            "python",
            "c",
            "cpp",
            "csharp",
            "dart",
            "go",
            "json",
            "kotlin",
            "matlab",
            "perl",
            "php",
            "r",
            "ruby",
            "rust",
            "scala",
            "sql",
            "swift",
            "typescript",
            "markdown",
            "properties",
            "yaml",
            "xml",
            "other",
        ];

        async function sumLanguages(rangeStart, rangeEnd) {
            const groupStage = {
                _id: null,
            };
            for (const k of languageKeys) {
                groupStage[k] = { $sum: { $ifNull: [`$languages.${k}`, 0] } };
            }
            const agg = await CodingSession.aggregate([
                { $match: { startTime: { $gte: rangeStart, $lte: rangeEnd } } },
                { $group: groupStage },
            ]);
            const doc = agg[0] || {};
            const out = {};
            for (const k of languageKeys) {
                const sec = doc[k] || 0;
                out[k] = +(sec / 3600).toFixed(2); // hours
            }
            return out;
        }

        const [currentTotals, previousTotals] = await Promise.all([
            sumLanguages(startCurrent, endCurrent),
            sumLanguages(startPrev, endPrev),
        ]);

        // Limit to top N based on currentTotals; accumulate 'other'
        const entries = Object.entries(currentTotals).sort(
            (a, b) => b[1] - a[1]
        );
        if (limit && Number.isFinite(limit)) {
            const top = entries.slice(0, limit).map(([k]) => k);
            const resultCur = {};
            const resultPrev = {};
            let otherCur = 0;
            let otherPrev = 0;
            for (const [k, v] of entries) {
                if (top.includes(k)) {
                    resultCur[k] = v;
                    resultPrev[k] = previousTotals[k] || 0;
                } else {
                    otherCur += v;
                    otherPrev += previousTotals[k] || 0;
                }
            }
            if (otherCur > 0 || otherPrev > 0) {
                resultCur.other = +otherCur.toFixed(2);
                resultPrev.other = +otherPrev.toFixed(2);
            }
            return { current: resultCur, previous: resultPrev };
        }
        return { current: currentTotals, previous: previousTotals };
    },

    // Fastest growing users by delta hours for the period
    async getUserGrowth(period = "week", limit = 10) {
        const now = new Date();
        let days = 7;
        if (typeof period === "string") {
            switch (period.toLowerCase()) {
                case "day":
                case "1d":
                    days = 1;
                    break;
                case "week":
                case "7d":
                    days = 7;
                    break;
                case "month":
                case "30d":
                    days = 30;
                    break;
                default:
                    days = 7;
            }
        }
        const startCurrent = startOfDay(addDays(now, -days + 1));
        const endCurrent = now;
        const startPrev = startOfDay(addDays(startCurrent, -days));
        const endPrev = addDays(startCurrent, -1);

        // Aggregate seconds per user for current and previous periods
        const [curRows, prevRows] = await Promise.all([
            CodingSession.aggregate([
                {
                    $match: {
                        startTime: { $gte: startCurrent, $lte: endCurrent },
                    },
                },
                { $group: { _id: "$userId", seconds: { $sum: "$duration" } } },
            ]),
            CodingSession.aggregate([
                { $match: { startTime: { $gte: startPrev, $lte: endPrev } } },
                { $group: { _id: "$userId", seconds: { $sum: "$duration" } } },
            ]),
        ]);

        const prevMap = new Map(prevRows.map((r) => [r._id, r.seconds || 0]));

        // Build entries with delta
        let entries = curRows.map((r) => {
            const userId = r._id;
            const cur = r.seconds || 0;
            const prev = prevMap.get(userId) || 0;
            const delta = cur - prev;
            return {
                userId,
                currentSeconds: cur,
                previousSeconds: prev,
                deltaSeconds: delta,
            };
        });

        // Include users that only had previous activity but none now (negative growth)
        for (const r of prevRows) {
            if (!entries.find((e) => e.userId === r._id)) {
                entries.push({
                    userId: r._id,
                    currentSeconds: 0,
                    previousSeconds: r.seconds || 0,
                    deltaSeconds: -(r.seconds || 0),
                });
            }
        }

        // Sort by delta descending and limit
        entries.sort((a, b) => b.deltaSeconds - a.deltaSeconds);
        if (limit && Number.isFinite(limit)) entries = entries.slice(0, limit);

        // Fetch user display info
        const ids = entries.map((e) => e.userId);
        const users = await User.find(
            { userId: { $in: ids } },
            {
                userId: 1,
                username: 1,
                displayName: 1,
                avatarUrl: 1,
                totalCodingTime: 1,
            }
        ).lean();
        const uMap = new Map(users.map((u) => [u.userId, u]));

        return entries.map((e) => {
            const u = uMap.get(e.userId);
            const name = u?.displayName || u?.username || "Anonymous";
            return {
                userId: e.userId,
                name,
                avatarUrl: u?.avatarUrl || null,
                deltaHours: +(e.deltaSeconds / 3600).toFixed(2),
                totalHours: +(e.currentSeconds / 3600).toFixed(2),
            };
        });
    },
};

module.exports = StatsService;
