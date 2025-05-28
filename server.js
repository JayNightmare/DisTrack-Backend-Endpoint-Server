const express = require('express');
const app = express();
const { connectToDatabase } = require('./database.js');
const PORT = 7071;
const User = require('./User.js');
const { API_KEY } = require('./config.js');

app.use(express.json());

connectToDatabase();

app.get('/', (req, res) => {
    res.send('Hello from the server!');
    console.log('Server is running!');
});

app.post('/coding-session', async (req, res) => {
    console.log('Received coding session request:', req.body);
    const { userId, duration, sessionDate, languages } = req.body;

    if (!userId || !duration || !sessionDate) {
        console.log('Missing required fields:', { userId, duration, sessionDate });
        return res.status(400).json({ message: "Missing required fields" });
    }

    try {
        let user = await User.findOne({ userId });
        console.log('User found:', user);
        const today = new Date(sessionDate);

        // If user doesn't exist, create a new document
        if (!user) {
            console.log('Creating new user:', userId);
            user = new User({ userId });
        }

        const lastSessionDate = user.lastSessionDate ? new Date(user.lastSessionDate) : null;
        console.log('Last session date:', lastSessionDate);

        // Update total coding time
        user.totalCodingTime += duration;
        console.log('Updated total coding time:', user.totalCodingTime);

        // Streak logic
        if (lastSessionDate) {
            const daysBetween = Math.floor((today - lastSessionDate) / (1000 * 60 * 60 * 24));
            console.log('Days between sessions:', daysBetween);

            if (daysBetween === 1) {
                user.currentStreak += 1;
                console.log('Increased streak:', user.currentStreak);
            } else if (daysBetween > 1) {
                user.currentStreak = 1;
                console.log('Reset streak to 1');
            }
        } else {
            user.currentStreak = 1;
            console.log('First session, streak set to 1');
        }

        // Update longest streak if the current streak exceeds it
        if (user.currentStreak > user.longestStreak) {
            user.longestStreak = user.currentStreak;
            console.log('Updated longest streak:', user.longestStreak);
        }

        // Update last session date
        user.lastSessionDate = today;
        console.log('Updated last session date:', user.lastSessionDate);

        // Update language-specific coding time
        for (const lang in languages) {
            if (languages.hasOwnProperty(lang) && user.languages.hasOwnProperty(lang)) {
                user.languages[lang] += languages[lang];
                console.log(`Updated ${lang} time:`, user.languages[lang]);
            }
        }

        // Save the updated user document
        await user.save();
        console.log('User saved successfully');

        res.status(200).json({ message: "Session recorded successfully!" });
    } catch (error) {
        console.error("Error recording session:", error);
        return res.status(500).json({ message: "Error recording session" });
    }
});

app.post('/link', async (req, res) => {
    console.log("POST /link endpoint hit");
    const { userId } = req.body;

    try {
        let user = await User.findOne({ userId });
        if (!user) {
            user = new User({ userId });
            await user.save();
        }

        res.status(200).json({ message: "User linked successfully" });
        console.log(`User ${userId} linked successfully.`);
    } catch (error) {
        console.error("Error linking user:", error);
        return res.status(500).json({ message: "Error linking user" });
    }
});

// * Fetch leaderboard stats - top 10 users by longest coding time
app.get('/leaderboard', async (req, res) => { // Add 'req' parameter
    console.log("GET /leaderboard endpoint hit");
    try {
        const users = await User.find().sort({ totalCodingTime: -1 });
        const leaderboard = users.slice(0, 10).map((user) => ({
            username: user.username || 'Anonymous', // Ensure username exists
            totalCodingTime: user.totalCodingTime,
            userId: user.userId
        }));
        res.status(200).json(leaderboard); // Send array directly instead of wrapping in object
    } catch (error) {
        console.error("Error fetching leaderboard:", error);
        return res.status(500).json({ 
            error: "Internal server error",
            details: error.message 
        });
    }
});

app.get('/user-profile/:userId', async (req, res) => {
    const { userId } = req.params;
    console.log(`GET /user-profile/${userId} endpoint hit`);

    try {
        const user = await User.findOne({ userId });
        if (!user) {
            return res.status(404).json({ message: "User not found" });
        }

        const userProfile = {
            userId: user.userId,
            username: user.username,
            totalCodingTime: user.totalCodingTime,
            currentStreak: user.currentStreak,
            longestStreak: user.longestStreak,
            lastSessionDate: user.lastSessionDate
        };

        res.status(200).json(userProfile);
        console.log(`User profile for ${userId} retrieved successfully.`);
    } catch (error) {
        console.error("Error fetching user profile:", error);
        return res.status(500).json({ message: "Error fetching user profile" });
    }
});

// Get streak data for a user
app.get('/streak/:userId', async (req, res) => {
    const { userId } = req.params;
    console.log(`GET /streak/${userId} endpoint hit`);

    try {
        const user = await User.findOne({ userId });
        if (!user) {
            return res.status(404).json({ message: "User not found" });
        }

        const streakData = {
            currentStreak: user.currentStreak,
            longestStreak: user.longestStreak
        };

        res.status(200).json(streakData);
        console.log(`Streak data for ${userId} retrieved successfully.`);
    } catch (error) {
        console.error("Error fetching streak data:", error);
        return res.status(500).json({ 
            message: "Error fetching streak data",
            defaultValues: { currentStreak: 0, longestStreak: 0 }
        });
    }
});

// Get language durations for a user
app.get('/languages/:userId', async (req, res) => {
    const { userId } = req.params;
    console.log(`GET /languages/${userId} endpoint hit`);

    try {
        const user = await User.findOne({ userId });
        if (!user) {
            return res.status(404).json({ message: "User not found" });
        }

        // Filter out languages with 0 duration
        const languages = Object.fromEntries(
            Object.entries(user.languages).filter(([_, duration]) => duration > 0)
        );

        res.status(200).json(languages);
        console.log(`Language durations for ${userId} retrieved successfully.`);
    } catch (error) {
        console.error("Error fetching language durations:", error);
        return res.status(500).json({
            message: "Error fetching language durations",
            defaultValues: {}
        });
    }
});

// Middleware for API key authentication
function authenticateApiKey(req, res, next) {
    const token = req.headers['authorization']?.split(' ')[1];
    if (!token || token !== API_KEY) {
        return res.status(403).json({ message: 'Forbidden: Invalid API Key' });
    }
    next();
}

// Apply API key authentication globally
app.use(authenticateApiKey);

app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
