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

// In-memory store: sessions[sessionId] = { units: [], lastUpdated: 0, spectatorId: string }
const sessions = {};
// Map spectatorId -> sessionId (Edit ID)
const spectatorMap = {};

io.on('connection', (socket) => {
    console.log('User connected:', socket.id);

    socket.on('join_session', (inputId) => {
        let sessionId = inputId;
        let isReadOnly = false;
        let spectatorId = null;

        // Check if inputId is a Spectator ID
        if (spectatorMap[inputId]) {
            sessionId = spectatorMap[inputId];
            isReadOnly = true;
            console.log(`Socket ${socket.id} joined as SPECTATOR for session ${sessionId}`);
        } else {
            // It's an Edit ID (or new session)
            console.log(`Socket ${socket.id} joined as EDITOR for session ${sessionId}`);

            // Create session if not exists
            if (!sessions[sessionId]) {
                // Generate a random spectator ID for this session
                const newSpectatorId = Math.random().toString(36).substring(2, 15);
                sessions[sessionId] = {
                    units: [],
                    mapImage: null,
                    overrides: {}, // Config overrides (shipTypes, etc.)
                    lastUpdated: Date.now(),
                    spectatorId: newSpectatorId
                };
                spectatorMap[newSpectatorId] = sessionId;
            }
            spectatorId = sessions[sessionId].spectatorId;
        }

        socket.join(sessionId);

        // Store permission in socket data
        socket.data.isReadOnly = isReadOnly;
        socket.data.sessionId = sessionId; // Store actual session ID

        // Inform client of their role and relevant IDs
        socket.emit('session_info', {
            role: isReadOnly ? 'spectator' : 'editor',
            sessionId: sessionId,
            spectatorId: isReadOnly ? inputId : spectatorId // If editor, send the spec ID to share
        });

        // Send current session data if exists, ELSE send empty init to trigger sync
        if (sessions[sessionId]) {
            socket.emit('init_data', {
                units: sessions[sessionId].units,
                mapImage: sessions[sessionId].mapImage,
                overrides: sessions[sessionId].overrides
            });
        } else {
            // New session needs explicit empty init to unlock client
            socket.emit('init_data', { units: [], mapImage: null, overrides: {} });
        }
    });

    socket.on('update_data', ({ sessionId, units }) => {
        // Security Check
        if (socket.data.isReadOnly) {
            console.warn(`Socket ${socket.id} attempted update_data without permission.`);
            return;
        }

        // Use socket.data.sessionId to ensure they update the session they joined
        const realSessionId = socket.data.sessionId || sessionId;

        // Update server store
        if (!sessions[realSessionId]) {
            sessions[realSessionId] = { units: [], lastUpdated: 0 };
        }
        sessions[realSessionId].units = units;
        sessions[realSessionId].lastUpdated = Date.now();

        // Broadcast to others in the room
        socket.to(realSessionId).emit('server_update', units);
    });

    socket.on('update_map', ({ sessionId, mapImage }) => {
        // Security Check
        if (socket.data.isReadOnly) {
            console.warn(`Socket ${socket.id} attempted update_map without permission.`);
            return;
        }

        const realSessionId = socket.data.sessionId || sessionId;

        if (!sessions[realSessionId]) {
            sessions[realSessionId] = { units: [], mapImage: null, lastUpdated: 0 };
        }
        sessions[realSessionId].mapImage = mapImage;
        socket.to(realSessionId).emit('map_update', mapImage);
    });

    socket.on('update_config', ({ sessionId, overrides }) => {
        // Security Check
        if (socket.data.isReadOnly) {
            console.warn(`Socket ${socket.id} attempted update_config without permission.`);
            return;
        }

        const realSessionId = socket.data.sessionId || sessionId;

        if (!sessions[realSessionId]) {
            sessions[realSessionId] = { units: [], mapImage: null, overrides: {}, lastUpdated: 0 };
        }
        sessions[realSessionId].overrides = overrides;
        console.log(`Session ${realSessionId} config updated`);
        socket.to(realSessionId).emit('config_update', overrides);
    });

    socket.on('disconnect', () => {
        console.log('User disconnected:', socket.id);
    });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
    console.log(`SERVER RUNNING ON PORT ${PORT}`);
});
