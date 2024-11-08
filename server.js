const express = require('express');
const app = express();
require('dotenv').config();

const PORT = process.env.PORT || 3000;

app.use(express.json());

app.post('/coding-session', (req, res) => {
    const { user, duration } = req.body;
    console.log(`User: ${user}, Duration: ${duration} seconds`);

    // Here, you would send this data to your Discord bot.
    // For now, let's just respond with a success message.
    res.json({ message: 'Coding session recorded!' });
});

app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
