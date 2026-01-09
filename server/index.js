const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());

const server = http.createServer(app);
const io = new Server(server, {
    maxHttpBufferSize: 5e7, // 50MB
    cors: {
        origin: "*", // Allow all origins for simplicity in this setup
        methods: ["GET", "POST"]
    }
});

// In-memory store: sessions[sessionId] = { units: [], lastUpdated: 0 }
const sessions = {};

io.on('connection', (socket) => {
    console.log('User connected:', socket.id);

    socket.on('join_session', (sessionId) => {
        socket.join(sessionId);
        console.log(`Socket ${socket.id} joined session ${sessionId}`);

        // Send current session data if exists
        if (sessions[sessionId]) {
            socket.emit('init_data', { units: sessions[sessionId].units, mapImage: sessions[sessionId].mapImage });
        } else {
            // New session, init empty or wait for client to push
            sessions[sessionId] = { units: [], mapImage: null, lastUpdated: Date.now() };
            // Request client to send their initial data if they have it?
            // Or assume fresh session starts empty.
            // If client has local data they want to "upload" to this session, they should emit update immediately after join.
        }
    });

    socket.on('update_data', ({ sessionId, units }) => {
        // Update server store
        if (!sessions[sessionId]) {
            sessions[sessionId] = { units: [], lastUpdated: 0 };
        }
        sessions[sessionId].units = units;
        sessions[sessionId].lastUpdated = Date.now();

        // Broadcast to others in the room
        socket.to(sessionId).emit('server_update', units);
    });

    socket.on('update_map', ({ sessionId, mapImage }) => {
        if (!sessions[sessionId]) {
            sessions[sessionId] = { units: [], mapImage: null, lastUpdated: 0 };
        }
        sessions[sessionId].mapImage = mapImage;
        socket.to(sessionId).emit('map_update', mapImage);
    });

    socket.on('disconnect', () => {
        console.log('User disconnected:', socket.id);
    });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
    console.log(`SERVER RUNNING ON PORT ${PORT}`);
});
