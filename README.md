# DisTrack Endpoint Server

This is the backend server for the DisTrack Discord bot and VSCode extension integration. It handles and stores coding session data from the VSCode extension and provides an API for the Discord bot to retrieve and display this data.

## Table of Contents
- [DisTrack Endpoint Server](#distrack-endpoint-server)
  - [Table of Contents](#table-of-contents)
  - [Overview](#overview)
  - [Features](#features)
  - [Installation](#installation)
  - [Configuration](#configuration)
  - [API Endpoints](#api-endpoints)
    - [POST `/coding-session`](#post-coding-session)
    - [POST `/link`](#post-link)
  - [Usage](#usage)
  - [Contributing](#contributing)
  - [License](#license)

## Overview

The DisTrack Endpoint Server collects coding session data from the DisTrack VSCode extension, including time spent coding, languages used, and Discord user IDs. This data is then accessible to the DisTrack Discord bot for generating user profiles and achievements.

## Features

- **Store Coding Session Data**: Records coding session duration, user language statistics, and last session date.
- **User Management**: Links Discord user IDs with coding session data.
- **Achievement Tracking**: Updates user achievements when coding milestones are reached.

## Installation

1. **Clone the Repository**:
   ```bash
   git clone https://github.com/yourusername/DisTrack-Endpoint.git
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

## Usage

1. **Start the Server**:
   - Run the following command to start the server:
     ```bash
     node server.js
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