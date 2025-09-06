const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');

const app = express();
const server = http.createServer(app);

// Configure CORS for Socket.IO
const io = socketIo(server, {
  cors: {
    origin: "*", // In production, specify your domain
    methods: ["GET", "POST"]
  }
});

// Middleware
app.use(cors());
app.use(express.json());

// Store active rooms and users
const rooms = new Map();
const users = new Map();

// Basic health check endpoint
app.get('/', (req, res) => {
  res.json({ 
    message: 'WebRTC Signaling Server is running',
    activeRooms: rooms.size,
    activeUsers: users.size
  });
});

// Socket.IO connection handling
io.on('connection', (socket) => {
  console.log(`User connected: ${socket.id}`);
  
  // User joins a room
  socket.on('join-room', (data) => {
    const { roomId, username } = data;
    
    // Leave any previous rooms
    Array.from(socket.rooms).forEach(room => {
      if (room !== socket.id) {
        socket.leave(room);
      }
    });
    
    // Join the new room
    socket.join(roomId);
    
    // Store user info
    users.set(socket.id, { username, roomId });
    
    // Initialize room if it doesn't exist
    if (!rooms.has(roomId)) {
      rooms.set(roomId, new Set());
    }
    
    // Add user to room
    rooms.get(roomId).add(socket.id);
    
    // Get other users in the room
    const otherUsers = Array.from(rooms.get(roomId))
      .filter(id => id !== socket.id)
      .map(id => ({
        id,
        username: users.get(id)?.username
      }));
    
    // Notify user about other users in room
    socket.emit('users-in-room', otherUsers);
    
    // Notify other users about new user
    socket.to(roomId).emit('user-joined', {
      id: socket.id,
      username
    });
    
    console.log(`${username} joined room: ${roomId}`);
  });
  
  // Handle WebRTC offer
  socket.on('offer', (data) => {
    const { targetId, offer } = data;
    const user = users.get(socket.id);
    
    socket.to(targetId).emit('offer', {
      fromId: socket.id,
      fromUsername: user?.username,
      offer
    });
    
    console.log(`Offer sent from ${socket.id} to ${targetId}`);
  });
  
  // Handle WebRTC answer
  socket.on('answer', (data) => {
    const { targetId, answer } = data;
    const user = users.get(socket.id);
    
    socket.to(targetId).emit('answer', {
      fromId: socket.id,
      fromUsername: user?.username,
      answer
    });
    
    console.log(`Answer sent from ${socket.id} to ${targetId}`);
  });
  
  // Handle ICE candidates
  socket.on('ice-candidate', (data) => {
    const { targetId, candidate } = data;
    
    socket.to(targetId).emit('ice-candidate', {
      fromId: socket.id,
      candidate
    });
  });
  
  // Handle chat messages (fallback for when WebRTC isn't established)
  socket.on('message', (data) => {
    const user = users.get(socket.id);
    if (!user) return;
    
    const messageData = {
      fromId: socket.id,
      username: user.username,
      message: data.message,
      timestamp: Date.now()
    };
    
    // Send to all users in the room
    socket.to(user.roomId).emit('message', messageData);
  });
  
  // Handle disconnection
  socket.on('disconnect', () => {
    const user = users.get(socket.id);
    
    if (user) {
      const { roomId, username } = user;
      
      // Remove user from room
      if (rooms.has(roomId)) {
        rooms.get(roomId).delete(socket.id);
        
        // Clean up empty rooms
        if (rooms.get(roomId).size === 0) {
          rooms.delete(roomId);
        }
      }
      
      // Notify other users in room
      socket.to(roomId).emit('user-left', {
        id: socket.id,
        username
      });
      
      console.log(`${username} disconnected from room: ${roomId}`);
    }
    
    // Clean up user data
    users.delete(socket.id);
  });
});

// Start server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Signaling server running on port ${PORT}`);
  console.log(`Visit http://localhost:${PORT} for server status`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully');
  server.close(() => {
    console.log('Server closed');
  });
});
