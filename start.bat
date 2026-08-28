@echo off
echo Starting Journeymate Pro Environment...

echo Starting Laravel Backend Server (Port 8000)...
start "Laravel Backend" cmd /k "cd backend && php artisan serve --host=0.0.0.0"

echo Starting Laravel Reverb WebSocket Server (Port 8081)...
start "Reverb Server" cmd /k "cd backend && php artisan reverb:start --port=8081"

echo Starting Laravel Queue Worker...
start "Queue Worker" cmd /k "cd backend && php artisan queue:listen"

echo Starting Vite Frontend Server (Port 8080)...
start "Vite Frontend" cmd /k "npm run dev"

echo Starting ngrok tunnel (Port 8080)...
start "ngrok Tunnel" cmd /k "ngrok http 8080"

echo All services have been started in separate windows!
echo You can close this window now.
