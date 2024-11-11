const express = require('express');
const crypto = require('crypto');
const app = express();
const { connectToDatabase } = require('./database.js');
const PORT = 7071;
const User = require('./User.js');

app.use(express.json());

connectToDatabase();

app.get('/', (req, res) => {
    res.send('Hello from the server!');
    res.send('Server is running!');
    console.log('Server is running!');
});

// Secret for verifying the GitHub webhook (set this to the same secret you use in GitHub's webhook settings)
const GITHUB_WEBHOOK_SECRET = 'your-github-webhook-secret';

// GitHub Signature Verification
function verifyGitHubSignature(req) {
    const signature = req.headers['x-hub-signature-256'];
    const payload = JSON.stringify(req.body);
    const hmac = crypto.createHmac('sha256', GITHUB_WEBHOOK_SECRET);
    const digest = 'sha256=' + hmac.update(payload).digest('hex');
    return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(digest));
}

app.post('/webhook/github', async (req, res) => {
    if (!verifyGitHubSignature(req)) {
        return res.status(403).send('Forbidden');
    }

    const { action, sender } = req.body;
    const githubUsername = sender.login; // GitHub username from the webhook payload

    try {
        if (action === 'created') { // New sponsorship event
            // Find a user with a matching GitHub username (set via /premium command)
            const user = await User.findOne({ githubUsername });

            if (user) {
                // User found, grant them premium status and add a badge
                user.premium = true;
                user.badges.push({ name: 'Sponsor', icon: '<:sponsor:emoji_id>', dateEarned: new Date() });
                await user.save();
                console.log(`${githubUsername} is now a premium member!`);
                
                // Send confirmation to Discord (optional)
                // Your Discord webhook code here to notify the dev server
            } else {
                // No match found, log info
                console.log(`No matching user found for GitHub username: ${githubUsername}`);
            }

            res.status(200).json({ message: `${githubUsername} sponsorship processed.` });
        } else if (action === 'cancelled') { // Optional: Handle canceled sponsorship
            const user = await User.findOne({ githubUsername });
            if (user && user.premium) {
                user.premium = false;
                await user.save();
                console.log(`Premium status removed for: ${githubUsername}`);
            }

            res.status(200).json({ message: `${githubUsername}'s premium status removed.` });
        } else {
            res.status(200).json({ message: "Webhook received, no action taken." });
        }
    } catch (error) {
        console.error("Error processing GitHub webhook:", error);
        res.status(500).json({ message: "Error processing GitHub webhook." });
    }
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
        res.status(500).json({ message: "Error recording session" });
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
        res.status(500).json({ message: "Error linking user" });
    }
});

app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
