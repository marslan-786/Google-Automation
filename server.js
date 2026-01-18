const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const { startBot, stopBot } = require('./bot'); // Bot Logic Import

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Public folder serve karein
app.use(express.static(path.join(__dirname, 'public')));

// Socket Connection
io.on('connection', (socket) => {
    console.log('⚡ Dashboard Connected');

    // Start Command from Frontend
    socket.on('start_bot', (settings) => {
        console.log('🚀 Command Received: Start Bot');
        // Bot ko settings aur socket pass karein taake wo logs bhej sake
        startBot(settings, socket);
    });

    // Stop Command
    socket.on('stop_bot', () => {
        console.log('🛑 Command Received: Stop Bot');
        stopBot();
    });
});

const PORT = process.env.PORT || 8080;
server.listen(PORT, () => {
    console.log(`👑 Google Master Bot running on port ${PORT}`);
});
