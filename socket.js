const socketIo = require('socket.io');
let io;

// Initialize socket server
const initializeSocket = (server) => {
  io = socketIo(server, {
    cors: {
      origin: '*',
      methods: ['GET', 'POST']
    }
  });

  io.on('connection', (socket) => {
    console.log('New client connected:', socket.id);
    
    socket.on('disconnect', () => {
      console.log('Client disconnected:', socket.id);
    });
    
    // Handle specific client events
    socket.on('registerSession', (sessionId) => {
      console.log(`Client ${socket.id} registered for session ${sessionId}`);
      socket.join(sessionId); // Join a room for this session
    });
  });

  console.log('Socket.io server initialized');
  return io;
};

// Get the socket.io instance
const getIO = () => {
  if (!io) {
    console.warn('Socket.io not initialized. Call initializeSocket first.');
    return null;
  }
  return io;
};

module.exports = {
  initializeSocket,
  getIO,
  // For direct access when imported
  get io() {
    return getIO();
  }
}; 