const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const uploadRoutes = require('./routes/uploadroutes.js');

const app = express();

// Create uploads directory if it doesn't exist
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir);
}

app.use(cors());
app.use(express.json());
app.use('/api', uploadRoutes);

// Log all incoming requests
app.use((req, res, next) => {
    // console.log(`${new Date().toISOString()} - ${req.method} ${req.url}`);
    next();
});

const PORT = 5000;
app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
    console.log(`Uploads directory: ${uploadsDir}`);
});
