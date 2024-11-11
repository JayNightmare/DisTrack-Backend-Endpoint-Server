// const mongoose = require("mongoose");
// const { MONGODB_URI } = require("./config.js");
const { MongoClient } = require('mongodb');

// async function connectToDatabase() {
//     try {
//         await mongoose.connect(MONGODB_URI, {
//             useNewUrlParser: true,
//             useUnifiedTopology: true,
//             serverSelectionTimeoutMS: 20000,
//             bufferCommands: false,
//         });
//         console.log("Connected to MongoDB");
//     } catch (error) {
//         console.error("Failed to connect to MongoDB:", error);
//     }
// }


const uri = process.env.MONGODB_URI; // Use the MongoDB URI from the environment variable
const dbName = process.env.DB;
const client = new MongoClient(uri, { useNewUrlParser: true, useUnifiedTopology: true });

async function connectToDatabase() {
    if (!client.topology?.isConnected()) {
        await client.connect();
        console.log("Connected to MongoDB");
    }
    return client.db(dbName); // Return the database instance
}

module.exports = { connectToDatabase };
