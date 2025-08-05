<div align=center>
  <img src="images/New Distrack.jpg" width=225 radius=10 />
</div>

<div align=center>
  <h1>Dis.Track</h1>
  <h2>DisTrack Endpoint Server</h2>
</div>

This is the backend server for the DisTrack Discord bot and VSCode extension integration. It handles and stores coding session data from the VSCode extension and provides an API for the Discord bot to retrieve and display this data.

## Table of Contents
- [Table of Contents](#table-of-contents)
- [Overview](#overview)
- [Features](#features)
- [Installation](#installation)
- [Configuration](#configuration)
- [API Endpoints](#api-endpoints)
  - [Core Endpoints](#core-endpoints)
  - [POST `/coding-session`](#post-coding-session)
  - [POST `/link`](#post-link)
  - [Leaderboard Endpoints](#leaderboard-endpoints)
  - [GET `/leaderboard/:timeframe`](#get-leaderboardtimeframe)
  - [POST `/snapshot/:timeframe`](#post-snapshottimeframe)
  - [GET `/user/:userId/history/:timeframe`](#get-useruseridhistorytimeframe)
- [Usage](#usage)
- [Data Management](#data-management)
  - [Automated Cleanup](#automated-cleanup)
  - [Data Retention Policies](#data-retention-policies)
  - [Manual Cleanup](#manual-cleanup)
    - [Trigger Cleanup via API:](#trigger-cleanup-via-api)
    - [Trigger Cleanup via Code:](#trigger-cleanup-via-code)
    - [What Happens During Cleanup:](#what-happens-during-cleanup)
    - [Benefits:](#benefits)
- [Contributing](#contributing)
- [License](#license)

## Overview

The DisTrack Endpoint Server collects coding session data from the DisTrack VSCode extension, including time spent coding, languages used, and Discord user IDs. This data is then accessible to the DisTrack Discord bot for generating user profiles and achievements.

## Features

- **Store Coding Session Data**: Records individual coding sessions with detailed metadata.
- **User Management**: Links Discord user IDs with coding session data.
- **Achievement Tracking**: Updates user achievements when coding milestones are reached.
- **Leaderboard with Trends**: Track rank changes over different timeframes (day, week, month, allTime).
- **Historical Snapshots**: Maintain historical leaderboard data for trend analysis.
- **Scheduled Jobs**: Automated snapshot taking for consistent trend tracking.
- **Session-Level Tracking**: Individual session records for accurate timeframe calculations.
- **Health Monitoring**: Comprehensive system health checks and monitoring.
- **Real-Time Analytics**: Live trend calculations based on actual session data.
- **Automated Data Cleanup**: Smart data retention system to prevent database bloat.
- **Data Aggregation**: Historical data preservation through intelligent aggregation.
- **Storage Optimization**: Automatic cleanup of old data while maintaining trends.

## Installation

1. **Clone the Repository**:
   ```bash
   git clone https://github.com/JayNightmare/DisTrack-Endpoint-Server.git
   ```
2. **Install Dependencies**:
   ```bash
   cd DisTrack-Endpoint
   npm install
   ```

## Configuration

1. **Set Environment Variables**:
   - Create a `.env` file in the root directory with the following variables:
     ```plaintext
     PORT=3000  # or any other port you'd like the server to run on
     MONGODB_URI=your_mongodb_connection_uri
     ```
   - Ensure the IP address of your server is whitelisted on MongoDB Atlas if using a cloud database.

2. **MongoDB Setup**:
   - Make sure MongoDB is installed and running.
   - Create a database for DisTrack (if not already done in the bot setup).

## API Endpoints

### Core Endpoints

### POST `/coding-session`

- **Description**: Stores coding session data from the VSCode extension.
- **Body Parameters**:
  - `userId` (string, required): The Discord user ID.
  - `duration` (number, required): The coding session duration in seconds.
  - `sessionDate` (string, required): The date of the coding session in ISO format.
  - `languages` (object, optional): An object where keys are language names and values are time spent (in seconds) coding in each language.
  
- **Example Request**:
  ```json
  {
    "userId": "123456789012345678",
    "duration": 3600,
    "sessionDate": "2024-11-10T18:05:20.630Z",
    "languages": {
      "javascript": 1800,
      "html": 1200,
      "css": 600
    }
  }
  ```

### POST `/link`

- **Description**: Links a Discord user ID to a coding session profile if not already present.
- **Body Parameters**:
  - `userId` (string, required): The Discord user ID to be linked.
  
- **Example Request**:
  ```json
  {
    "userId": "123456789012345678"
  }
  ```

### Leaderboard Endpoints

### GET `/leaderboard/:timeframe`

- **Description**: Get leaderboard with rank trends for a specific timeframe.
- **Parameters**:
  - `timeframe` (string): "day", "week", "month", or "allTime"
  - `limit` (query, optional): Number of top users to return (default: 10)
  
- **Example Response**:
  ```json
  [
    {
      "userId": "123456789012345678",
      "username": "JohnDoe",
      "rank": 1,
      "totalTime": 3600,
      "rankDelta": 2,
      "previousRank": 3
    }
  ]
  ```

### POST `/snapshot/:timeframe`

- **Description**: Take a snapshot of the current leaderboard for trend tracking.
- **Parameters**:
  - `timeframe` (string): "day", "week", "month", or "allTime"
- **Body (optional)**:
  ```json
  {
    "date": "2023-07-29T00:00:00Z"
  }
  ```

### GET `/user/:userId/history/:timeframe`

- **Description**: Get a user's rank history for a specific timeframe.
- **Parameters**:
  - `userId` (string): The user ID
  - `timeframe` (string): "day", "week", "month", or "allTime"
  - `limit` (query, optional): Number of historical records (default: 30)

## Usage

1. **Start the Server**:
   - Run the following command to start the server:
     ```bash
     npm start
     ```

2. **Test Trend System**:
   - Run the trend system test:
     ```bash
     npm run test-trends
     ```

3. **API Usage**:
   - The server will be accessible at `http://localhost:7071` by default.
   - Use tools like Postman or curl to test the endpoints.

4. **Trend Tracking Setup**:
   - Take initial snapshots: `POST /snapshots/all`
   - Set up scheduled jobs for regular snapshots (see `LEADERBOARD_TRENDS.md`)
   - Monitor system health: `GET /admin/snapshot/health`

5. **Database Management**:
   - Monitor database stats: `GET /admin/stats`
   - Trigger manual cleanup: `POST /admin/cleanup`
   - Check cron job status: `GET /admin/cron/status`

For detailed information about the trend tracking system, see `LEADERBOARD_TRENDS.md`.

## Data Management

### Automated Cleanup

The server includes an intelligent data retention system that automatically manages database size:

- **🕛 Schedule**: Cleanup runs every Sunday at 02:00 UTC
- **📊 Monitoring**: Database statistics checked every Monday at 09:00 UTC
- **⚠️ Alerts**: Automatic warnings when storage exceeds 100MB

### Data Retention Policies

| Data Type | Retention Period | Action |
|-----------|------------------|---------|
| **Coding Sessions** | 90 days | Aggregate then delete detailed records |
| **Daily Snapshots** | 30 days | Delete old snapshots |
| **Weekly Snapshots** | 6 months | Delete old snapshots |
| **Monthly Snapshots** | 2 years | Delete old snapshots |
| **All-Time Snapshots** | Forever | Never deleted |
| **Inactive Users** | 1 year | Archive (mark as archived) |

### Manual Cleanup

#### Trigger Cleanup via API:
```bash
# Full cleanup
curl -X POST http://localhost:7071/admin/cleanup \
  -H "Authorization: Bearer YOUR_API_KEY"

# Get database statistics
curl -X GET http://localhost:7071/admin/stats \
  -H "Authorization: Bearer YOUR_API_KEY"
```

#### Trigger Cleanup via Code:
```javascript
// Manual cleanup
const result = await CronScheduler.triggerSnapshot('cleanup');

// Get database stats
const stats = await DataRetentionService.getDatabaseStats();
```

#### What Happens During Cleanup:
1. **Session Aggregation**: Old coding sessions are grouped by user/date and stored as aggregated records
2. **Snapshot Cleanup**: Old leaderboard snapshots are removed based on retention policies
3. **User Archiving**: Inactive users are marked as archived (not deleted)
4. **Statistics Update**: Database size and health metrics are recalculated

#### Benefits:
- **Preserved Trends**: Historical data is aggregated, not lost
- **Optimized Storage**: Database size stays manageable
- **Performance**: Faster queries with less data
- **Cost Effective**: Reduced storage costs for cloud deployments
     ```

2. **Testing with Postman**:
   - Use [Postman](https://www.postman.com/) or a similar tool to send POST requests to test the `/coding-session` and `/link` endpoints.

## Contributing

1. Fork the repository.
2. Create a new branch:
   ```bash
   git checkout -b feature-branch
   ```
3. Commit changes:
   ```bash
   git commit -m "Add a new feature"
   ```
4. Push to the branch:
   ```bash
   git push origin feature-branch
   ```
5. Open a pull request.

## License

This project is licensed under the MIT License. See the [LICENSE](LICENSE) file for more details.
```

This `README.md` gives a clear overview of the server's purpose, setup, configuration, API details, and usage, helping anyone understand how to work with and contribute to the endpoint server. Let me know if you'd like any further customizations!
