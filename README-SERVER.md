# Video Meeting Server Setup

## Prerequisites
- Node.js installed on your system
- npm or yarn package manager

## Installation

1. Install server dependencies:
```bash
npm install express socket.io cors
npm install -D nodemon
```

2. Start the signaling server:
```bash
node server.js
```

Or for development with auto-restart:
```bash
npm install -g nodemon
nodemon server.js
```

## Configuration

The server runs on port 3001 by default. You can change this by setting the PORT environment variable:

```bash
PORT=3002 node server.js
```

## Usage

1. Start the server first
2. Open your React app (it will connect to http://localhost:3001)
3. Join a meeting room - multiple participants can now see each other's video streams

## Features

- Real-time signaling for WebRTC connections
- Room-based meetings
- Automatic participant management
- ICE candidate exchange
- SDP offer/answer handling

The server handles:
- User joining/leaving rooms
- WebRTC signaling (offers, answers, ICE candidates)
- Broadcasting messages to room participants
- Connection state management