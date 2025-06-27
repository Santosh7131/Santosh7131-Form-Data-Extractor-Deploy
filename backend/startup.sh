#!/bin/bash

# Install system dependencies
apt-get update
apt-get install -y graphicsmagick

# Install Node.js dependencies
npm install

# Install Python dependencies
pip install psycopg2-binary

# Start the server
node server.js 