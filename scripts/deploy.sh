#!/bin/bash

# Exit on error
set -e

echo "Deploying ClipSmart AI Backend..."

# Update packages
echo "Updating packages..."
sudo apt-get update
sudo apt-get upgrade -y

# Install Node.js if not already installed
if ! command -v node &> /dev/null; then
    echo "Installing Node.js..."
    curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
    sudo apt-get install -y nodejs
fi

# Install PM2 if not already installed
if ! command -v pm2 &> /dev/null; then
    echo "Installing PM2..."
    sudo npm install -g pm2
fi

# Install FFmpeg if not already installed (required for video processing)
if ! command -v ffmpeg &> /dev/null; then
    echo "Installing FFmpeg..."
    sudo apt-get install -y ffmpeg
fi

# Go to application directory
cd "$(dirname "$0")/.."

# Install dependencies
echo "Installing dependencies..."
npm install --production

# Setup environment
if [ ! -f .env ]; then
    echo "Setting up environment variables..."
    cp .env.example .env
    echo "Please edit the .env file with your production values!"
    exit 1
fi

# Create temp directory if it doesn't exist
mkdir -p temp

# Start/Restart the application with PM2
echo "Starting application with PM2..."
pm2 restart ecosystem.config.js --env production || pm2 start ecosystem.config.js --env production

# Setup PM2 to start on boot
echo "Setting up PM2 to start on boot..."
pm2 save
sudo env PATH=$PATH:/usr/bin pm2 startup systemd -u $USER --hp $HOME

echo "Deployment completed successfully!"
echo "Your application should be running at http://localhost:4001"
echo "Make sure to set up Nginx or another reverse proxy for production use." 