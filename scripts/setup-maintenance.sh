#!/bin/bash

# Exit on error
set -e

# Check if script is run as root
if [ "$EUID" -ne 0 ]; then
  echo "Please run as root or with sudo"
  exit 1
fi

# Get the script directory path
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
TEMP_DIR="$PROJECT_DIR/temp"

echo "Setting up maintenance scripts for ClipSmart AI..."

# Create temp directory if it doesn't exist
if [ ! -d "$TEMP_DIR" ]; then
    mkdir -p "$TEMP_DIR"
    echo "Created temp directory at $TEMP_DIR"
fi

# Ask for days to keep temp files
read -p "Enter number of days to keep temporary video files (default: 7): " DAYS_TO_KEEP
DAYS_TO_KEEP=${DAYS_TO_KEEP:-7}

# Create cleanup script
CLEANUP_SCRIPT="/usr/local/bin/clipsmartai-cleanup.sh"
echo "Creating cleanup script at $CLEANUP_SCRIPT..."

cat > "$CLEANUP_SCRIPT" << EOF
#!/bin/bash

# Clean up old files in the temp directory
find $TEMP_DIR -type f -mtime +$DAYS_TO_KEEP -delete
find $TEMP_DIR -type d -empty -delete

# Log the cleanup
echo "\$(date): Cleaned up files older than $DAYS_TO_KEEP days from $TEMP_DIR" >> /var/log/clipsmartai-cleanup.log
EOF

# Make it executable
chmod +x "$CLEANUP_SCRIPT"

# Set up cron job for daily cleanup
CRON_FILE="/etc/cron.d/clipsmartai-cleanup"
echo "Setting up cron job at $CRON_FILE..."

cat > "$CRON_FILE" << EOF
# ClipSmart AI - Daily cleanup of temporary files
0 3 * * * root $CLEANUP_SCRIPT
EOF

# Set up log rotation
LOGROTATE_FILE="/etc/logrotate.d/clipsmartai"
echo "Setting up log rotation at $LOGROTATE_FILE..."

cat > "$LOGROTATE_FILE" << EOF
/var/log/clipsmartai-cleanup.log {
    weekly
    rotate 4
    compress
    delaycompress
    missingok
    notifempty
    create 0640 root root
}

$PROJECT_DIR/logs/*.log {
    daily
    rotate 7
    compress
    delaycompress
    missingok
    notifempty
    create 0640 root root
    sharedscripts
    postrotate
        [ -f /var/run/nginx.pid ] && kill -USR1 \$(cat /var/run/nginx.pid)
    endscript
}
EOF

# Create logs directory
mkdir -p "$PROJECT_DIR/logs"

# Set up disk space monitoring
MONITOR_SCRIPT="/usr/local/bin/clipsmartai-disk-monitor.sh"
echo "Creating disk space monitoring script at $MONITOR_SCRIPT..."

cat > "$MONITOR_SCRIPT" << EOF
#!/bin/bash

# Get disk usage percentage
DISK_USAGE=\$(df -h / | grep / | awk '{print \$5}' | sed 's/%//')

# If disk usage is over 80%, send an alert
if [ \$DISK_USAGE -ge 80 ]; then
    echo "\$(date): WARNING! Disk usage is at \${DISK_USAGE}%" >> /var/log/clipsmartai-disk-monitor.log
    
    # Additional action could be added here, like sending an email
    # mail -s "ClipSmart AI Disk Space Alert" admin@example.com << MAIL_CONTENT
    # Disk usage on the ClipSmart AI server is at \${DISK_USAGE}%.
    # Please check and free up some space.
    # MAIL_CONTENT
fi
EOF

# Make it executable
chmod +x "$MONITOR_SCRIPT"

# Set up cron job for hourly disk monitoring
DISK_CRON_FILE="/etc/cron.d/clipsmartai-disk-monitor"
echo "Setting up disk monitoring cron job at $DISK_CRON_FILE..."

cat > "$DISK_CRON_FILE" << EOF
# ClipSmart AI - Hourly disk space monitoring
0 * * * * root $MONITOR_SCRIPT
EOF

echo "Maintenance setup completed!"
echo "The following maintenance tasks have been set up:"
echo "1. Daily cleanup of temp files older than $DAYS_TO_KEEP days at 3:00 AM"
echo "2. Log rotation for application logs"
echo "3. Hourly disk space monitoring with alerts at 80% usage" 