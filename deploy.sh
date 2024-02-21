# Navigate to your project directory
cd /home/adminssg/server/backend_postgres_ssg

# Pull the latest changes from GitHub
git pull

# Install dependencies
npm install

# Restart your Node.js application using PM2
pm2 restart server
