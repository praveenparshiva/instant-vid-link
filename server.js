const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');

const app = express();
const server = http.createServer(app);

app.use(cors());
app.use(express.json());

const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// Store rooms and participants
const rooms = new Map();

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  // Join room
  socket.on('join-room', (data) => {
    const { roomId, userName } = data;
    
    socket.join(roomId);
    socket.roomId = roomId;
    socket.userName = userName;
    
    // Initialize room if it doesn't exist
    if (!rooms.has(roomId)) {
      rooms.set(roomId, new Set());
    }
    
    const room = rooms.get(roomId);
    room.add(socket.id);
    
    // Notify others in the room
    socket.to(roomId).emit('user-joined', {
      id: socket.id,
      name: userName
    });
    
    // Send existing participants to the new user
    const existingParticipants = Array.from(room)
      .filter(id => id !== socket.id)
      .map(id => {
        const participant = Array.from(io.sockets.sockets.values())
          .find(s => s.id === id);
        return participant ? { id, name: participant.userName } : null;
      })
      .filter(Boolean);
    
    socket.emit('existing-participants', existingParticipants);
    
    console.log(`${userName} joined room ${roomId}`);
  });

  // Handle WebRTC signaling
  socket.on('offer', (data) => {
    socket.to(data.to).emit('offer', {
      offer: data.offer,
      from: socket.id,
      fromName: socket.userName
    });
  });

  socket.on('answer', (data) => {
    socket.to(data.to).emit('answer', {
      answer: data.answer,
      from: socket.id
    });
  });

  socket.on('ice-candidate', (data) => {
    socket.to(data.to).emit('ice-candidate', {
      candidate: data.candidate,
      from: socket.id
    });
  });

  // Handle disconnect
  socket.on('disconnect', () => {
    if (socket.roomId && socket.userName) {
      const room = rooms.get(socket.roomId);
      if (room) {
        room.delete(socket.id);
        if (room.size === 0) {
          rooms.delete(socket.roomId);
        }
      }
      
      // Notify others in the room
      socket.to(socket.roomId).emit('user-left', {
        id: socket.id,
        name: socket.userName
      });
      
      console.log(`${socket.userName} left room ${socket.roomId}`);
    }
    console.log('User disconnected:', socket.id);
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Signaling server running on port ${PORT}`);
});