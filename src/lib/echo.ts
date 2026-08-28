import Echo from 'laravel-echo';
import Pusher from 'pusher-js';

(window as any).Pusher = Pusher;

// Determine WebSocket config based on environment.
// In dev, Vite proxies /app/* to Reverb (localhost:8081) so we connect to the same origin.
// In prod, use explicit env vars.
const isProd = import.meta.env.PROD;
const currentPort = window.location.port
  ? parseInt(window.location.port, 10)
  : (window.location.protocol === 'https:' ? 443 : 80);

const echo = new Echo({
    broadcaster: 'reverb',
    key: import.meta.env.VITE_REVERB_APP_KEY,
    wsHost: isProd ? import.meta.env.VITE_REVERB_HOST : window.location.hostname,
    wsPort: isProd ? (import.meta.env.VITE_REVERB_PORT ?? 443) : currentPort,
    wssPort: isProd ? (import.meta.env.VITE_REVERB_PORT ?? 443) : currentPort,
    forceTLS: window.location.protocol === 'https:',
    enabledTransports: ['ws', 'wss'],
    authorizer: (channel: any, _options: any) => {
        return {
            authorize: (socketId: string, callback: Function) => {
                // Relative URL — goes through Vite proxy in dev, direct in prod
                const authUrl = isProd
                    ? `${import.meta.env.VITE_API_URL || '/api'}/broadcasting/auth`
                    : `${window.location.origin}/api/broadcasting/auth`;
                const token = localStorage.getItem('auth_token');

                fetch(authUrl, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Accept': 'application/json',
                        'Authorization': `Bearer ${token}`,
                        'ngrok-skip-browser-warning': 'true',
                    },
                    body: JSON.stringify({
                        socket_id: socketId,
                        channel_name: channel.name
                    })
                })
                .then(response => response.json())
                .then(data => {
                    callback(false, data);
                })
                .catch(error => {
                    callback(true, error);
                });
            }
        };
    },
});

export default echo;
