<?php

namespace App\Http\Controllers;

use App\Models\User;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Auth;
use Illuminate\Validation\ValidationException;
use Laravel\Socialite\Facades\Socialite; 

class AuthController extends Controller
{
    public function register(Request $request)
    {
        $request->validate([
            'username' => 'required|string|unique:users,username',
            'email' => 'required|string|email|unique:users,email',
            'password' => 'required|string|min:8|confirmed',
        ]);

        $user = User::create([
            'username' => $request->username,
            'email' => $request->email,
            'password' => Hash::make($request->password),
            'profile_pic' => 'https://ui-avatars.com/api/?name=' . urlencode($request->username) . '&background=38a1db&color=fff'
        ]);

        $token = $user->createToken('auth_token')->plainTextToken;
        $user->setAttribute('stats', $user->calculateStats());

        return response()->json([
            'user' => $user,
            'token' => $token
        ]);
    }

    public function login(Request $request)
    {
        $request->validate([
            'username' => 'required|string',
            'password' => 'required|string',
        ]);

        // Support login by Email OR Username
        $fieldType = filter_var($request->username, FILTER_VALIDATE_EMAIL) ? 'email' : 'username';

        if (!Auth::attempt([$fieldType => $request->username, 'password' => $request->password])) {
            throw ValidationException::withMessages([
                'username' => ['Invalid credentials provided.'],
            ]);
        }

        $user = Auth::user();
        $token = $user->createToken('auth_token')->plainTextToken;
        $user->setAttribute('stats', $user->calculateStats());

        return response()->json([
            'user' => $user,
            'token' => $token
        ]);
    }

    public function logout(Request $request)
    {
        $request->user()->currentAccessToken()->delete();
        return response()->json(['message' => 'Logged out successfully']);
    }

    public function user(Request $request)
    {
        $user = $request->user();
        $user->setAttribute('stats', $user->calculateStats());
        return response()->json($user);
    }

    /**
     * Reliably detect the real origin (scheme + host) even through proxy chains.
     * ngrok/Vite proxy may not always forward X-Forwarded-Proto correctly.
     */
    private function getRealOrigin(Request $request): string
    {
        $host = $request->getHost();
        
        // If the host is a known HTTPS-only service, force https
        if (str_contains($host, 'ngrok') || str_contains($host, 'railway')) {
            return "https://{$host}";
        }
        
        // Otherwise trust Laravel's detection (TrustProxies + X-Forwarded-Proto)
        return $request->getSchemeAndHttpHost();
    }

    public function googleRedirect(Request $request)
    {
        $origin = $this->getRealOrigin($request);
        $redirectUri = "{$origin}/api/auth/google/callback";
        
        \Illuminate\Support\Facades\Log::info("Google Redirect URI generated: " . $redirectUri);
        
        config(['services.google.redirect' => $redirectUri]);
        
        return Socialite::driver('google')->stateless()->redirect();
    }

    public function googleCallback(Request $request)
    {
        try {
            $origin = $this->getRealOrigin($request);
            $redirectUri = "{$origin}/api/auth/google/callback";
            config(['services.google.redirect' => $redirectUri]);

            $googleUser = Socialite::driver('google')->stateless()->user();

            // Find existing user or create new one
            $user = User::updateOrCreate(
                ['email' => $googleUser->getEmail()],
                [
                    'username' => $googleUser->getName() ?? $googleUser['email'],
                    'google_id' => $googleUser->getId(),
                    'profile_pic' => $googleUser->getAvatar(),
                    'password' => null, // No password for Google users
                ]
            );
            Auth::login($user);
            $token = $user->createToken('auth_token')->plainTextToken;
            $user->setAttribute('stats', $user->calculateStats());

            // Same origin — no port needed since frontend and API share the same host via proxy
            return redirect("{$origin}/auth/callback?token={$token}");

        } catch (\Exception $e) {
            \Illuminate\Support\Facades\Log::error('Google Login Error: ' . $e->getMessage(), ['trace' => $e->getTraceAsString()]);
            $origin = $this->getRealOrigin($request);

            return redirect("{$origin}/login?error=" . urlencode("Google login failed: " . $e->getMessage()));
        }
    }
}
