import { useState } from "react";
import { motion } from "framer-motion";
import {
  Globe, Palette, UserCircle, Shield, Bell, Download,
  LogOut, Moon, Sun, Sunset, Waves, Mountain,
  Eye, Check, Languages, UserPlus
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { toast } from "@/hooks/use-toast";
import { languages } from "@/data/mockData";
import { useTheme, type ThemeId } from "@/theme/ThemeProvider";
import { useT } from "@/i18n/I18nProvider";
import { useAuth } from "@/auth/AuthProvider";
import type { Lang } from "@/i18n/translations";

const item = { hidden: { opacity: 0, y: 12 }, show: { opacity: 1, y: 0 } };
const container = { hidden: {}, show: { transition: { staggerChildren: 0.04 } } };

const themes = [
  { id: "light", label: "Light", icon: Sun, colors: ["#f8f9fa", "#10b981", "#f59e0b"] },
  { id: "dark", label: "Dark", icon: Moon, colors: ["#0f172a", "#34d399", "#f59e0b"] },
  { id: "adventure", label: "Adventure", icon: Mountain, colors: ["#1a1a2e", "#e94560", "#0f3460"] },
  { id: "ocean", label: "Ocean", icon: Waves, colors: ["#0a192f", "#64ffda", "#8892b0"] },
  { id: "sunset", label: "Sunset", icon: Sunset, colors: ["#2d1b69", "#ff6b6b", "#ffd93d"] },
];

const socialProviders = [
  { id: "google", label: "Google", icon: "🔵", connected: true },
  { id: "apple", label: "Apple", icon: "🍎", connected: false },
  { id: "facebook", label: "Facebook", icon: "📘", connected: false },
  { id: "twitter", label: "X (Twitter)", icon: "🐦", connected: false },
];

export default function SettingsPage() {
  const { theme, setTheme } = useTheme();
  const { lang, setLang, t } = useT();
  const { user, signOut } = useAuth();
  const [guestMode, setGuestMode] = useState(user?.guest ?? false);
  const [offlineMode, setOfflineMode] = useState(true);
  const [notifications, setNotifications] = useState(true);
  const [locationSharing, setLocationSharing] = useState(true);
  const [editOpen, setEditOpen] = useState(false);
  const [signOutOpen, setSignOutOpen] = useState(false);
  const [connectedProviders, setConnectedProviders] = useState<string[]>([user?.provider ?? "google"]);
  const [editName, setEditName] = useState(user?.name ?? "Alex Rivera");
  const [editEmail, setEditEmail] = useState(user?.email ?? "alex.rivera@email.com");

  const handleSaveProfile = () => {
    toast({ title: "✅ Profile Updated!", description: "Your changes have been saved." });
    setEditOpen(false);
  };

  const handleThemeChange = (themeId: string) => {
    setTheme(themeId as ThemeId);
    toast({ title: `🎨 Theme: ${themes.find(t => t.id === themeId)?.label}`, description: "Theme applied." });
  };

  const handleLangChange = (code: string) => {
    setLang(code as Lang);
    const l = languages.find(x => x.code === code);
    toast({ title: `🌐 ${l?.name}`, description: "Language switched." });
  };

  const toggleProvider = (id: string) => {
    const isConnected = connectedProviders.includes(id);
    setConnectedProviders(prev => isConnected ? prev.filter(p => p !== id) : [...prev, id]);
    const provider = socialProviders.find(p => p.id === id);
    toast({
      title: isConnected ? `❌ ${provider?.label} Disconnected` : `✅ ${provider?.label} Connected`,
      description: isConnected ? "Account unlinked." : "Account linked successfully.",
    });
  };

  const handleToggle = (name: string, value: boolean, setter: (v: boolean) => void) => {
    setter(value);
    toast({ title: `${value ? "✅" : "❌"} ${name} ${value ? "Enabled" : "Disabled"}` });
  };

  const handleSignOut = () => {
    signOut();
    toast({ title: "👋 Signed Out", description: "You've been signed out successfully." });
    setSignOutOpen(false);
  };

  return (
    <motion.div variants={container} initial="hidden" animate="show" className="px-4 py-4 pb-6 space-y-4">
      <motion.div variants={item}>
        <h2 className="font-display font-bold text-xl tracking-tight">Settings</h2>
        <p className="text-[11px] text-muted-foreground mt-0.5">Customize your Intellitravel experience</p>
      </motion.div>

      {/* Profile */}
      <motion.div variants={item}>
        <Card className="border-0 card-elevated">
          <CardContent className="p-4">
            <div className="flex items-center gap-3.5">
              <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-primary to-primary/70 flex items-center justify-center shadow-travel">
                <UserCircle className="w-7 h-7 text-primary-foreground" />
              </div>
              <div className="flex-1">
                <h3 className="font-display font-bold text-base">{editName}</h3>
                <p className="text-[11px] text-muted-foreground">{editEmail}</p>
                <Badge className="text-[9px] h-[18px] mt-1 bg-accent/10 text-accent font-semibold border-0">Explorer Level 12</Badge>
              </div>
              <Button variant="outline" size="sm" className="h-8 text-xs rounded-xl font-semibold" onClick={() => setEditOpen(true)}>Edit</Button>
            </div>
          </CardContent>
        </Card>
      </motion.div>

      {/* Guest Mode */}
      <motion.div variants={item}>
        <Card className="border-0 card-elevated">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-info/8 flex items-center justify-center">
                  <Eye className="w-4.5 h-4.5 text-info" />
                </div>
                <div>
                  <h4 className="font-semibold text-[13px]">Guest Mode</h4>
                  <p className="text-[10px] text-muted-foreground">Browse without account (limited)</p>
                </div>
              </div>
              <Switch checked={guestMode} onCheckedChange={(v) => handleToggle("Guest Mode", v, setGuestMode)} />
            </div>
            {guestMode && (
              <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} className="mt-3 p-2.5 bg-info/5 rounded-xl">
                <p className="text-[10px] text-info font-medium">Guest mode active — Some features like reviews and tracking are disabled.</p>
              </motion.div>
            )}
          </CardContent>
        </Card>
      </motion.div>

      {/* Themes */}
      <motion.div variants={item}>
        <Card className="border-0 card-elevated">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-3">
              <Palette className="w-4 h-4 text-primary" />
              <h4 className="font-semibold text-[13px]">Theme</h4>
            </div>
            <div className="grid grid-cols-5 gap-2">
              {themes.map(th => {
                const Icon = th.icon;
                return (
                  <button
                    key={th.id}
                    onClick={() => handleThemeChange(th.id)}
                    className={`flex flex-col items-center gap-1.5 p-2.5 rounded-xl transition-all tap-highlight ${theme === th.id ? "bg-primary/8 ring-2 ring-primary" : "bg-muted"
                      }`}
                  >
                    <div className="flex gap-0.5">
                      {th.colors.map((c, i) => (
                        <div key={i} className="w-3 h-3 rounded-full shadow-sm" style={{ backgroundColor: c }} />
                      ))}
                    </div>
                    <Icon className="w-3.5 h-3.5" />
                    <span className="text-[9px] font-semibold">{th.label}</span>
                    {theme === th.id && <Check className="w-3 h-3 text-primary" />}
                  </button>
                );
              })}
            </div>
          </CardContent>
        </Card>
      </motion.div>

      {/* Language */}
      <motion.div variants={item}>
        <Card className="border-0 card-elevated">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-3">
              <Languages className="w-4 h-4 text-primary" />
              <h4 className="font-semibold text-[13px]">Language</h4>
              <Badge variant="outline" className="text-[9px] h-[18px] ml-auto font-semibold">{languages.length}</Badge>
            </div>
            <div className="grid grid-cols-2 gap-1.5 max-h-40 overflow-y-auto">
              {languages.map(l => (
                <button
                  key={l.code}
                  onClick={() => handleLangChange(l.code)}
                  className={`flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-xs transition-all tap-highlight ${lang === l.code ? "bg-primary/8 text-primary ring-1 ring-primary/20 font-semibold" : "bg-muted text-foreground hover:bg-muted/80 font-medium"
                    }`}
                >
                  <span className="text-sm">{l.flag}</span>
                  <span>{l.name}</span>
                  {lang === l.code && <Check className="w-3 h-3 ml-auto" />}
                </button>
              ))}
            </div>
          </CardContent>
        </Card>
      </motion.div>

      {/* Social */}
      <motion.div variants={item}>
        <Card className="border-0 card-elevated">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-3">
              <UserPlus className="w-4 h-4 text-primary" />
              <h4 className="font-semibold text-[13px]">Connected Accounts</h4>
            </div>
            <div className="space-y-1.5">
              {socialProviders.map(provider => (
                <div key={provider.id} className="flex items-center justify-between p-3 bg-muted rounded-xl">
                  <div className="flex items-center gap-2.5">
                    <span className="text-lg">{provider.icon}</span>
                    <span className="text-xs font-semibold">{provider.label}</span>
                  </div>
                  {connectedProviders.includes(provider.id) ? (
                    <Button variant="ghost" size="sm" className="h-7 text-[10px] rounded-lg font-semibold text-success" onClick={() => toggleProvider(provider.id)}>
                      <Check className="w-3 h-3 mr-0.5" /> Connected
                    </Button>
                  ) : (
                    <Button variant="outline" size="sm" className="h-7 text-[10px] rounded-lg font-semibold" onClick={() => toggleProvider(provider.id)}>Connect</Button>
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </motion.div>

      {/* Toggles */}
      <motion.div variants={item}>
        <Card className="border-0 card-elevated">
          <CardContent className="p-4 space-y-4">
            {[
              { icon: Download, label: "Offline Mode", desc: "Cache maps & itineraries", state: offlineMode, setter: setOfflineMode },
              { icon: Bell, label: "Push Notifications", desc: "Trip updates & social alerts", state: notifications, setter: setNotifications },
              { icon: Shield, label: "Location Sharing", desc: "Share with trip members", state: locationSharing, setter: setLocationSharing },
            ].map(({ icon: Icon, label, desc, state, setter }) => (
              <div key={label} className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-muted flex items-center justify-center">
                    <Icon className="w-4.5 h-4.5 text-muted-foreground" />
                  </div>
                  <div>
                    <p className="text-[13px] font-semibold">{label}</p>
                    <p className="text-[10px] text-muted-foreground">{desc}</p>
                  </div>
                </div>
                <Switch checked={state} onCheckedChange={(v) => handleToggle(label, v, setter)} />
              </div>
            ))}
          </CardContent>
        </Card>
      </motion.div>

      {/* Logout */}
      <motion.div variants={item}>
        <Button variant="outline" className="w-full h-11 text-destructive border-destructive/15 gap-2 rounded-xl font-semibold" onClick={() => setSignOutOpen(true)}>
          <LogOut className="w-4 h-4" /> Sign Out
        </Button>
      </motion.div>

      <p className="text-center text-[10px] text-muted-foreground font-medium">Intellitravel v2.1.0 · Made with ❤️</p>

      {/* Edit Profile Dialog */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-w-[340px] rounded-2xl">
          <DialogHeader>
            <DialogTitle className="font-display">Edit Profile</DialogTitle>
            <DialogDescription>Update your personal info</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div>
              <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Name</label>
              <Input value={editName} onChange={e => setEditName(e.target.value)} className="mt-1.5 h-10 rounded-xl border-border" />
            </div>
            <div>
              <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Email</label>
              <Input value={editEmail} onChange={e => setEditEmail(e.target.value)} type="email" className="mt-1.5 h-10 rounded-xl border-border" />
            </div>
          </div>
          <Button className="w-full h-10 rounded-xl shadow-travel font-semibold" onClick={handleSaveProfile}>
            Save Changes
          </Button>
        </DialogContent>
      </Dialog>

      {/* Sign Out Confirmation */}
      <AlertDialog open={signOutOpen} onOpenChange={setSignOutOpen}>
        <AlertDialogContent className="max-w-[320px] rounded-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle className="font-display">Sign Out?</AlertDialogTitle>
            <AlertDialogDescription>
              You'll need to sign in again to access your trips and data.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="rounded-xl">Cancel</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90 rounded-xl" onClick={handleSignOut}>
              Sign Out
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </motion.div>
  );
}
