const express = require('express');
const app = express();
const { connectToDatabase } = require('./database.js');
const PORT = process.env.PORT || 3000;
const User = require('./User.js');

app.use(express.json());

connectToDatabase();

app.post('/coding-session', (req, res) => {
    const { user, duration } = req.body;
    console.log(`User: ${user}, Duration: ${duration} seconds`);
    res.json({ message: 'Coding session recorded!' });
});

app.post('/link', async (req, res) => {
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
