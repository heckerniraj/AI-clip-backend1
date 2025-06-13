#!/bin/bash

# Exit on error
set -e

# Check if script is run as root
if [ "$EUID" -ne 0 ]; then
  echo "Please run as root or with sudo"
  exit 1
fi

# Get the domain name from the user
if [ -z "$1" ]; then
  read -p "Enter your domain name (e.g., example.com): " DOMAIN
else
  DOMAIN=$1
fi

# Install Nginx if not already installed
if ! command -v nginx &> /dev/null; then
    echo "Installing Nginx..."
    apt-get update
    apt-get install -y nginx
fi

# Get the script directory path
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

# Create Nginx configuration
CONFIG_PATH="/etc/nginx/sites-available/clipsmartai"
echo "Creating Nginx configuration at $CONFIG_PATH..."

cat > "$CONFIG_PATH" << EOF
server {
    listen 80;
    server_name $DOMAIN www.$DOMAIN;

    location / {
        proxy_pass http://localhost:4001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_cache_bypass \$http_upgrade;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        
        # Increase timeout for large video uploads
        proxy_connect_timeout 300s;
        proxy_send_timeout 300s;
        proxy_read_timeout 300s;
    }

    # Allow large file uploads
    client_max_body_size 100M;
}
EOF

# Enable the site
if [ ! -L "/etc/nginx/sites-enabled/clipsmartai" ]; then
    echo "Enabling site..."
    ln -s "$CONFIG_PATH" /etc/nginx/sites-enabled/
fi

# Test Nginx configuration
echo "Testing Nginx configuration..."
nginx -t

# Restart Nginx
echo "Restarting Nginx..."
systemctl restart nginx

echo "Nginx setup completed for domain: $DOMAIN"
echo "Now you can set up SSL with Let's Encrypt using:"
echo "  sudo certbot --nginx -d $DOMAIN -d www.$DOMAIN"

# Ask if user wants to set up SSL now
read -p "Do you want to set up SSL with Let's Encrypt now? (y/n): " SETUP_SSL

if [ "$SETUP_SSL" = "y" ] || [ "$SETUP_SSL" = "Y" ]; then
    # Install certbot if not already installed
    if ! command -v certbot &> /dev/null; then
        echo "Installing Certbot..."
        apt-get update
        apt-get install -y certbot python3-certbot-nginx
    fi
    
    # Run certbot
    echo "Setting up SSL with Let's Encrypt..."
    certbot --nginx -d "$DOMAIN" -d "www.$DOMAIN"
    
    echo "SSL setup completed for $DOMAIN"
else
    echo "Skipping SSL setup. You can run it later with:"
    echo "  sudo certbot --nginx -d $DOMAIN -d www.$DOMAIN"
fi 