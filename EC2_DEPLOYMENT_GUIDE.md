# ClipSmart AI - AWS EC2 Deployment Guide

This guide provides step-by-step instructions for deploying the ClipSmart AI backend to an AWS EC2 instance.

## Prerequisites

1. An AWS account with permissions to create EC2 instances
2. MongoDB Atlas account or another MongoDB deployment (for database)
3. Basic familiarity with Linux commands
4. A domain name (optional but recommended for production)

## Step 1: Launch an EC2 Instance

1. Login to AWS console and navigate to EC2
2. Click "Launch Instance"
3. Choose Ubuntu Server 22.04 LTS
4. Select an instance type (recommended: t2.medium or better for video processing)
5. Configure instance details (default settings are usually fine)
6. Add storage (recommended: at least 30GB for video processing)
7. Add tags if needed
8. Configure security group:
   - Allow SSH (port 22) from your IP
   - Allow HTTP (port 80) from anywhere
   - Allow HTTPS (port 443) from anywhere
   - Allow Custom TCP (port 4001) from anywhere (optional, if not using Nginx)
9. Review and launch
10. Create or select a key pair for SSH access

## Step 2: Connect to Your EC2 Instance

```bash
ssh -i your-key.pem ubuntu@your-ec2-ip
```

## Step 3: Install Git and Clone Repository

```bash
sudo apt-get update
sudo apt-get install -y git
git clone <your-repository-url>
cd <repository-folder>/backend
```

## Step 4: Deploy Using Script

Our application includes a deployment script that sets up all necessary components:

```bash
chmod +x scripts/deploy.sh
./scripts/deploy.sh
```

This will:
- Install Node.js 18.x
- Install PM2 for process management
- Install FFmpeg for video processing
- Install application dependencies
- Create a template .env file
- Start the application using PM2

## Step 5: Configure Environment Variables

Edit the .env file with your production values:

```bash
nano .env
```

Ensure you update the following critical variables:

```
MONGODB_URL=<your-mongodb-connection-string>
MONGODB_URI=<your-mongodb-connection-string>
ALLOWED_ORIGINS=<your-frontend-domain>
OPENAI_API_KEY=<your-openai-api-key>
YOUTUBE_API_KEY=<your-youtube-api-key>
JWT_SECRET=<your-random-secret-string>
```

For JWT_SECRET, generate a random string:

```bash
openssl rand -base64 32
```

## Step 6: Setup Nginx as Reverse Proxy

Install and configure Nginx:

```bash
sudo apt-get install -y nginx
sudo cp scripts/nginx.conf /etc/nginx/sites-available/clipsmartai
```

Edit the configuration file to update your domain:

```bash
sudo nano /etc/nginx/sites-available/clipsmartai
```

Enable the site and restart Nginx:

```bash
sudo ln -s /etc/nginx/sites-available/clipsmartai /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl restart nginx
```

## Step 7: Setup SSL with Let's Encrypt (Recommended)

```bash
sudo apt-get install -y certbot python3-certbot-nginx
sudo certbot --nginx -d your-domain.com -d www.your-domain.com
```

Follow the prompts to complete SSL setup.

## Step 8: Test Your Deployment

Visit your domain or EC2 public IP to verify that the API is working:

```
http://your-domain.com
```

You should see a JSON response confirming the server is running.

## Alternative Deployment: Using Docker

If you prefer using Docker, the repository includes Dockerfile and docker-compose.yml:

1. Install Docker and Docker Compose:

```bash
sudo apt-get update
sudo apt-get install -y docker.io docker-compose
sudo systemctl enable docker
sudo systemctl start docker
sudo usermod -aG docker $USER
```

Log out and back in for group changes to take effect.

2. Build and run using Docker Compose:

```bash
cd <repository-folder>/backend
cp .env.example .env
nano .env  # Update with your production values
docker-compose up -d
```

## Video Processing Considerations

This application processes videos using FFmpeg. For optimal performance:

1. Ensure your EC2 instance has sufficient resources:
   - At least 2 vCPUs (t2.medium or better)
   - At least 4GB RAM
   - At least 30GB storage

2. Monitor disk usage regularly as video files can consume space quickly:
   ```bash
   df -h
   ```

3. Consider setting up a cron job to clean the temp directory periodically:
   ```bash
   crontab -e
   ```
   
   Add this line to delete files older than 7 days:
   ```
   0 0 * * * find /path/to/your/app/temp -type f -mtime +7 -exec rm {} \;
   ```

## Scaling Considerations

For handling more traffic:
- Use a load balancer with multiple EC2 instances
- Consider using AWS ElastiCache for session management
- Use Amazon S3 for video storage instead of local filesystem

## Troubleshooting

### Application Not Starting

Check the logs:
```bash
pm2 logs
```

### Nginx Not Working

Check Nginx error logs:
```bash
sudo tail -f /var/log/nginx/error.log
```

### SSL Issues

Verify SSL certificate:
```bash
sudo certbot certificates
```

## Maintenance

- To update the application:
  ```bash
  cd <repository-folder>/backend
  git pull
  npm install --production
  pm2 restart clipsmartai-backend
  ```

- To monitor the application:
  ```bash
  pm2 monit
  ```

- To backup your MongoDB database regularly:
  ```bash
  mongodump --uri="your-mongodb-uri" --out="/path/to/backup/$(date +%Y-%m-%d)"
  ``` 