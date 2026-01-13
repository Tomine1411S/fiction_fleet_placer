const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());

const server = http.createServer(app);
const io = new Server(server, {
    maxHttpBufferSize: 1e8, // 100MB
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
                    layers: [{ id: 1, name: 'Layer 1', visible: true, units: [], mapImage: null }],
                    activeLayerId: 1,
                    overrides: {},
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
        socket.data.sessionId = sessionId;

        socket.emit('session_info', {
            role: isReadOnly ? 'spectator' : 'editor',
            sessionId: sessionId,
            spectatorId: isReadOnly ? inputId : spectatorId
        });

        // Send current session data
        if (sessions[sessionId]) {
            socket.emit('init_data', {
                layers: sessions[sessionId].layers || [],
                activeLayerId: sessions[sessionId].activeLayerId || 1,
                overrides: sessions[sessionId].overrides
            });
        } else {
            socket.emit('init_data', {
                layers: [{ id: 1, name: 'Layer 1', visible: true, units: [], mapImage: null }],
                activeLayerId: 1,
                overrides: {}
            });
        }
    });

    socket.on('update_data', ({ sessionId, layers, activeLayerId }) => {
        // Security Check
        if (socket.data.isReadOnly) {
            console.warn(`Socket ${socket.id} attempted update_data without permission.`);
            return;
        }

        const realSessionId = socket.data.sessionId || sessionId;

        if (!sessions[realSessionId]) {
            sessions[realSessionId] = { layers: [], activeLayerId: 1, lastUpdated: 0 };
        }

        // Update store
        sessions[realSessionId].layers = layers;
        if (activeLayerId) sessions[realSessionId].activeLayerId = activeLayerId;
        sessions[realSessionId].lastUpdated = Date.now();

        // Broadcast
        socket.to(realSessionId).emit('server_update', { layers, activeLayerId });
    });

    // Legacy map update (kept but likely unused if layers handle map)
    socket.on('update_map', ({ sessionId, mapImage }) => {
        // ... existing legacy code ...
        // If client uses layers, map is inside layer. 
        // This might be redundant but harmless to keep if legacy client exists.
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
