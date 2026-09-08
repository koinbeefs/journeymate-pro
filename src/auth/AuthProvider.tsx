import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { repo } from "@/lib/storage";
import { authApi, API_URL } from "@/lib/api";
import { toast } from "@/hooks/use-toast";

export interface AuthUserStats {
  trips: number;
  reviews: number;
  saved: number;
  total_distance_km: number;
  cities: number;
  photos: number;
  level: number;
  current_xp: number;
  next_level_xp: number;
  total_xp: number;
}

export interface AuthUser {
  id?: string;
  name: string;
  email: string;
  avatar?: string;
  guest: boolean;
  provider?: "email" | "google" | "apple";
  stats?: AuthUserStats;
}

interface AuthCtx {
  user: AuthUser | null;
  ready: boolean;
  signInEmail: (email: string, password: string) => Promise<void>;
  signUpEmail: (name: string, email: string, password: string) => Promise<void>;
  signInGoogle: () => Promise<void>;
  signInApple: () => Promise<void>;
  signInGuest: () => void;
  signOut: () => void;
}

const Ctx = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const token = localStorage.getItem('auth_token');
    if (token) {
      // Verify token by fetching user
      authApi.getUser()
        .then(response => {
          const userData = response.data;
          setUser({
            id: userData.id?.toString(),
            name: userData.username,
            email: userData.email,
            avatar: userData.profile_pic,
            guest: false,
            provider: userData.google_id ? 'google' : 'email',
            stats: userData.stats,
          });
        })
        .catch((error: any) => {
          console.warn("getUser auth check failed, falling back to local session:", error?.message);
          localStorage.removeItem('auth_token');
          setUser(repo.auth.get());
        })
        .finally(() => setReady(true));
    } else {
      setUser(repo.auth.get());
      setReady(true);
    }
  }, []);

  const persist = (u: AuthUser, token?: string) => {
    if (token) {
      localStorage.setItem('auth_token', token);
    }
    repo.auth.set(u);
    setUser(u);
  };

  const signInEmail = async (email: string, password: string) => {
    try {
      const response = await authApi.login({ username: email, password });
      const userData = response.data.user;
      const token = response.data.token;
      persist({
        id: userData.id?.toString(),
        name: userData.username,
        email: userData.email,
        avatar: userData.profile_pic,
        guest: false,
        provider: 'email',
        stats: userData.stats,
      }, token);
    } catch (error: any) {
      toast({
        title: "Login failed",
        description: error.response?.data?.message || "Invalid credentials",
        variant: "destructive",
      });
      throw error;
    }
  };

  const signUpEmail = async (name: string, email: string, password: string) => {
    try {
      const response = await authApi.register({ username: name, email, password, password_confirmation: password });
      const userData = response.data.user;
      const token = response.data.token;
      persist({
        id: userData.id?.toString(),
        name: userData.username,
        email: userData.email,
        avatar: userData.profile_pic,
        guest: false,
        provider: 'email',
        stats: userData.stats,
      }, token);
    } catch (error: any) {
      toast({
        title: "Registration failed",
        description: error.response?.data?.message || "Registration failed",
        variant: "destructive",
      });
      throw error;
    }
  };

  const signInGoogle = async () => {
    // Redirect directly to the backend URL to avoid CORS errors caused by Axios XHR
    window.location.href = `${API_URL}/auth/google`;
  };

  const signInApple = async () => {
    // Apple login not implemented in backend yet
    toast({
      title: "Apple login not available",
      description: "Apple login is not currently supported",
      variant: "destructive",
    });
    throw new Error("Apple login not implemented");
  };

  const signInGuest = () => persist({ name: "Guest", email: "", guest: true });

  const signOut = async () => {
    try {
      if (localStorage.getItem('auth_token')) {
        await authApi.logout();
      }
    } catch (error) {
      // Ignore logout errors
    } finally {
      localStorage.removeItem('auth_token');
      repo.auth.clear();
      setUser(null);
    }
  };

  return (
    <Ctx.Provider value={{ user, ready, signInEmail, signUpEmail, signInGoogle, signInApple, signInGuest, signOut }}>
      {children}
    </Ctx.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useAuth outside AuthProvider");
  return ctx;
}
