'use client';

import React, { useState, useEffect } from 'react';
import {
  Volume2,
  UserCheck,
  Radio,
  Tv,
  Clock,
  Sparkles,
  Loader2,
  Check,
  RefreshCw,
  Server,
  Headphones,
  Save,
  Key,
  AlertTriangle,
  ShieldAlert,
  ShieldCheck,
  ExternalLink,
} from 'lucide-react';

interface VoiceSettingsPanelProps {
  initialTokenHealth?: any;
  onVoiceChannelChanged?: (guildId: string, vcId: string) => void;
  onTokenUpdated?: () => void;
  onSettingsSaved?: (settings: any) => void;
}

export const VoiceSettingsPanel: React.FC<VoiceSettingsPanelProps> = ({
  initialTokenHealth,
  onVoiceChannelChanged,
  onTokenUpdated,
  onSettingsSaved,
}) => {
  const [guilds, setGuilds] = useState<any[]>([]);
  const [selectedGuildId, setSelectedGuildId] = useState<string>('');
  const [selectedVcId, setSelectedVcId] = useState<string>('');
  const [userId, setUserId] = useState<string>('');
  const [autoFollow, setAutoFollow] = useState<boolean>(false);
  const [defaultQuality, setDefaultQuality] = useState<string>('1080p');
  const [autoEnglishSubs, setAutoEnglishSubs] = useState<boolean>(true);
  const [intermissionSeconds, setIntermissionSeconds] = useState<number>(120);

  // Token state
  const [tokenHealth, setTokenHealth] = useState<any>(initialTokenHealth || null);
  const [streamerTokenInput, setStreamerTokenInput] = useState<string>('');
  const [controllerTokenInput, setControllerTokenInput] = useState<string>('');
  const [torboxApiKeyInput, setTorboxApiKeyInput] = useState<string>('');

  const [loading, setLoading] = useState<boolean>(false);
  const [updatingTokens, setUpdatingTokens] = useState<boolean>(false);
  const [detectingUser, setDetectingUser] = useState<boolean>(false);
  const [statusMessage, setStatusMessage] = useState<string>('');
  const [error, setError] = useState<string>('');

  // Sync tokenHealth if initialTokenHealth prop updates
  useEffect(() => {
    if (initialTokenHealth) {
      setTokenHealth(initialTokenHealth);
    }
  }, [initialTokenHealth]);

  const loadData = async () => {
    setLoading(true);
    try {
      // 1. Fetch token health
      const tokenRes = await fetch('/api/token');
      const tokenData = await tokenRes.json();
      setTokenHealth(tokenData);

      // 2. Fetch guilds & voice channels
      const guildsRes = await fetch('/api/discord/guilds');
      const guildsData = await guildsRes.json();
      setGuilds(guildsData.guilds || []);

      // 3. Fetch settings
      const settingsRes = await fetch('/api/settings');
      const settingsData = await settingsRes.json();
      if (settingsData.settings) {
        const s = settingsData.settings;
        setUserId(s.userId || '');
        setAutoFollow(!!s.autoFollow);
        setDefaultQuality(s.defaultQuality || '1080p');
        setAutoEnglishSubs(s.autoEnglishSubs !== false);
        setIntermissionSeconds(s.intermissionSeconds || 120);

        if (s.selectedGuildId) setSelectedGuildId(s.selectedGuildId);
        if (s.selectedVoiceChannelId) setSelectedVcId(s.selectedVoiceChannelId);
      }
    } catch (err) {
      console.error('Settings load error:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const currentGuild = guilds.find((g) => g.id === selectedGuildId) || guilds[0];
  const voiceChannels = currentGuild?.voiceChannels || [];

  // Join selected VC
  const handleJoinSelectedVc = async () => {
    const targetGid = selectedGuildId || currentGuild?.id;
    const targetVc = selectedVcId || voiceChannels[0]?.id;

    if (!targetGid || !targetVc) {
      setError('Please select both a Server and a Voice Channel');
      return;
    }

    setLoading(true);
    setError('');
    setStatusMessage('');

    try {
      const res = await fetch('/api/discord/join-vc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ guildId: targetGid, voiceChannelId: targetVc }),
      });
      const data = await res.json();

      if (data.success) {
        const channelName = voiceChannels.find((v: any) => v.id === targetVc)?.name || 'Voice Channel';
        setStatusMessage(`🔊 Streamer successfully joined "${channelName}"! All future movies will stream here.`);
        if (onVoiceChannelChanged) onVoiceChannelChanged(targetGid, targetVc);
      } else {
        setError(data.error || 'Failed to join voice channel');
      }
    } catch (err) {
      setError('Connection error joining voice channel');
    } finally {
      setLoading(false);
    }
  };

  // Find user by User ID and join their VC
  const handleDetectUserVc = async () => {
    if (!userId.trim()) {
      setError('Enter your Discord User ID first');
      return;
    }

    setDetectingUser(true);
    setError('');
    setStatusMessage('');

    try {
      const res = await fetch(`/api/discord/user-vc?userId=${encodeURIComponent(userId.trim())}`);
      const data = await res.json();

      if (data.success && data.voiceState) {
        const vs = data.voiceState;
        setSelectedGuildId(vs.guildId);
        setSelectedVcId(vs.voiceChannelId);

        // Join detected VC
        await fetch('/api/discord/join-vc', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ guildId: vs.guildId, voiceChannelId: vs.voiceChannelId }),
        });

        // Also save user ID to settings
        await fetch('/api/settings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            userId: userId.trim(),
            selectedGuildId: vs.guildId,
            selectedVoiceChannelId: vs.voiceChannelId,
          }),
        });

        setStatusMessage(`🎯 Found you in "${vs.voiceChannelName}" (${vs.guildName})! Streamer joined your voice channel.`);
        if (onVoiceChannelChanged) onVoiceChannelChanged(vs.guildId, vs.voiceChannelId);
      } else {
        setError(`User ID "${userId}" was not found in any voice channel. Make sure you are currently in a VC on a server with the streamer.`);
      }
    } catch (err) {
      setError('Error detecting user voice channel');
    } finally {
      setDetectingUser(false);
    }
  };

  // Update Tokens (Streamer Token, Controller Token, TorBox)
  const handleUpdateTokens = async () => {
    if (!streamerTokenInput.trim() && !controllerTokenInput.trim() && !torboxApiKeyInput.trim()) {
      setError('Enter at least one token to update');
      return;
    }

    setUpdatingTokens(true);
    setError('');
    setStatusMessage('');

    try {
      const res = await fetch('/api/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          streamerToken: streamerTokenInput.trim() || undefined,
          controllerToken: controllerTokenInput.trim() || undefined,
          torboxApiKey: torboxApiKeyInput.trim() || undefined,
        }),
      });

      const data = await res.json();

      if (res.ok && data.success) {
        setStatusMessage(`🎉 ${data.message || 'Tokens updated and verified successfully!'}`);
        setStreamerTokenInput('');
        setControllerTokenInput('');
        setTorboxApiKeyInput('');
        loadData();
        if (onTokenUpdated) onTokenUpdated();
      } else {
        setError(data.error || 'Token validation failed. Check your token and try again.');
      }
    } catch (err) {
      setError('Error updating tokens. Please check your connection.');
    } finally {
      setUpdatingTokens(false);
    }
  };

  // Save general settings
  const handleSaveSettings = async () => {
    setLoading(true);
    setError('');
    setStatusMessage('');

    try {
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: userId.trim(),
          autoFollow,
          selectedGuildId: selectedGuildId || currentGuild?.id,
          selectedVoiceChannelId: selectedVcId || voiceChannels[0]?.id,
          defaultQuality,
          autoEnglishSubs,
          intermissionSeconds,
        }),
      });

      const data = await res.json();
      if (onSettingsSaved && data.settings) {
        onSettingsSaved(data.settings);
      }

      setStatusMessage('✅ All settings, default quality, and active Voice Channel saved successfully!');
      setTimeout(() => setStatusMessage(''), 3000);
    } catch (err) {
      setError('Failed to save settings');
    } finally {
      setLoading(false);
    }
  };

  const isTokenLoading = !tokenHealth;
  const isStreamerValid = tokenHealth?.streamer?.valid === true;
  const isStreamerExplicitlyInvalid = tokenHealth && tokenHealth.streamer && tokenHealth.streamer.valid === false;
  const isControllerValid = tokenHealth?.controller?.valid === true;
  const isTorboxValid = tokenHealth?.torbox?.valid === true;

  return (
    <div className="glass-panel-glow rounded-3xl p-6 lg:p-8 border border-white/15 shadow-2xl relative overflow-hidden space-y-6">
      {/* Background Ambient Glow */}
      <div className="absolute top-0 right-0 w-80 h-80 bg-indigo-600/10 rounded-full blur-3xl pointer-events-none" />

      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 pb-4 border-b border-white/10">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-indigo-600 to-purple-600 flex items-center justify-center text-white shadow-lg shadow-indigo-500/25">
            <Headphones className="w-6 h-6" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-white tracking-tight">Discord Voice, Token & Streamer Control</h2>
            <p className="text-xs text-gray-400">Manage Discord Voice Channels, Streamer User Token, and playback defaults</p>
          </div>
        </div>

        <button
          onClick={loadData}
          disabled={loading}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white/5 hover:bg-white/10 text-gray-300 text-xs transition-all active:scale-95"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          <span>Refresh Health & Guilds</span>
        </button>
      </div>

      {/* Status Alerts */}
      {statusMessage && (
        <div className="p-4 rounded-2xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 text-xs font-semibold flex items-center gap-2.5 animate-in fade-in">
          <Check className="w-4 h-4 text-emerald-400 shrink-0" />
          <span>{statusMessage}</span>
        </div>
      )}
      {error && (
        <div className="p-4 rounded-2xl bg-rose-500/15 border border-rose-500/30 text-rose-300 text-xs flex items-center gap-2.5 animate-in fade-in">
          <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* SECTION 1: TOKEN HEALTH & UPDATE MANAGER */}
      <div className="p-5 rounded-2xl bg-gradient-to-br from-indigo-950/40 via-purple-950/20 to-transparent border border-indigo-500/30 space-y-4">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Key className="w-5 h-5 text-indigo-400" />
            <h3 className="text-sm font-bold text-white">Discord Streamer & Bot Token Manager</h3>
          </div>

          {/* Status Pills */}
          <div className="flex items-center gap-2 flex-wrap">
            {/* Streamer Token Pill */}
            <span
              className={`text-[11px] font-mono px-2.5 py-0.5 rounded-full border flex items-center gap-1.5 ${
                isTokenLoading
                  ? 'bg-white/5 border-white/10 text-gray-400'
                  : isStreamerValid
                  ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-300'
                  : 'bg-rose-500/20 border-rose-500/40 text-rose-300 animate-pulse font-bold'
              }`}
            >
              {isTokenLoading ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-gray-400" />
                  Streamer: Checking...
                </>
              ) : isStreamerValid ? (
                <>
                  <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                  Streamer: {tokenHealth.streamer.user || 'Online'}
                </>
              ) : (
                <>
                  <ShieldAlert className="w-3.5 h-3.5 text-rose-400" />
                  Streamer: EXPIRED / INVALID
                </>
              )}
            </span>

            {/* Controller Bot Pill */}
            <span
              className={`text-[11px] font-mono px-2.5 py-0.5 rounded-full border flex items-center gap-1.5 ${
                isTokenLoading
                  ? 'bg-white/5 border-white/10 text-gray-400'
                  : isControllerValid
                  ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-300'
                  : 'bg-amber-500/15 border-amber-500/30 text-amber-300'
              }`}
            >
              {isTokenLoading ? (
                'Bot: Checking...'
              ) : isControllerValid ? (
                <>
                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                  Bot: {tokenHealth.controller.bot || 'Connected'}
                </>
              ) : (
                'Bot: Offline'
              )}
            </span>

            {/* TorBox Pill */}
            <span
              className={`text-[11px] font-mono px-2.5 py-0.5 rounded-full border flex items-center gap-1.5 ${
                isTokenLoading
                  ? 'bg-white/5 border-white/10 text-gray-400'
                  : isTorboxValid
                  ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-300'
                  : 'bg-rose-500/20 border-rose-500/40 text-rose-300'
              }`}
            >
              {isTokenLoading ? 'TorBox: Checking...' : isTorboxValid ? 'TorBox: Active' : 'TorBox: Missing/Invalid'}
            </span>
          </div>
        </div>

        {/* Healthy Confirmation Alert */}
        {isStreamerValid && (
          <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 text-xs flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0" />
            <span>Discord Streamer account (<strong>{tokenHealth?.streamer?.user || 'senzukobhai'}</strong>) is authenticated and ready to stream.</span>
          </div>
        )}

        {/* Warning if token is EXPLICITLY expired */}
        {isStreamerExplicitlyInvalid && (
          <div className="p-3.5 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs flex items-start gap-2.5">
            <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
            <div>
              <span className="font-bold">Streamer User Token is Expired or Invalid!</span>
              <p className="mt-0.5 text-rose-300/80">
                Discord session tokens rotate periodically. Paste your new Discord User Account Token below and click <strong>&quot;Update & Reconnect Streamer&quot;</strong> to resume streaming immediately without restarting the server.
              </p>
            </div>
          </div>
        )}

        {/* Token Update Form */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-2">
          <div>
            <label className="text-[11px] font-semibold text-gray-300 block mb-1">
              New Discord Streamer User Token (Go-Live Account)
            </label>
            <input
              type="password"
              value={streamerTokenInput}
              onChange={(e) => setStreamerTokenInput(e.target.value)}
              placeholder="Paste new DISCORD_STREAMER_TOKEN here..."
              className="w-full bg-[#161924] border border-white/15 rounded-xl px-3.5 py-2 text-xs text-white placeholder-gray-500 font-mono focus:outline-none focus:border-indigo-500"
            />
          </div>

          <div>
            <label className="text-[11px] font-semibold text-gray-300 block mb-1">
              TorBox API Key (Optional)
            </label>
            <input
              type="password"
              value={torboxApiKeyInput}
              onChange={(e) => setTorboxApiKeyInput(e.target.value)}
              placeholder="Paste new TORBOX_API_KEY here..."
              className="w-full bg-[#161924] border border-white/15 rounded-xl px-3.5 py-2 text-xs text-white placeholder-gray-500 font-mono focus:outline-none focus:border-indigo-500"
            />
          </div>
        </div>

        <button
          onClick={handleUpdateTokens}
          disabled={updatingTokens || (!streamerTokenInput.trim() && !torboxApiKeyInput.trim())}
          className="w-full py-2.5 rounded-xl bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white font-bold text-xs shadow-lg shadow-indigo-600/30 flex items-center justify-center gap-2 active:scale-98 transition-all disabled:opacity-40"
        >
          {updatingTokens ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              Verifying Token with Discord Gateway...
            </>
          ) : (
            <>
              <Key className="w-4 h-4" />
              Update & Reconnect Streamer Account
            </>
          )}
        </button>
      </div>

      {/* SECTION 2: VOICE CHANNEL & SERVER CONTROLS */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Card 1: Auto-Detect & Follow-Me User ID */}
        <div className="p-5 rounded-2xl bg-indigo-950/30 border border-indigo-500/25 flex flex-col justify-between space-y-4">
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm font-bold text-white flex items-center gap-2">
                <UserCheck className="w-4 h-4 text-indigo-400" />
                Discord User ID (Follow-Me Mode)
              </span>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 font-semibold">
                Auto-Target
              </span>
            </div>
            <p className="text-xs text-gray-300">
              Enter your Discord User ID. The stream worker will detect what server and voice channel you are sitting in and join it instantly.
            </p>
          </div>

          <div className="space-y-3">
            <div>
              <label className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider block mb-1.5">
                Your Discord User ID
              </label>
              <input
                type="text"
                value={userId}
                onChange={(e) => setUserId(e.target.value)}
                placeholder="e.g. 1544008805094785026"
                className="w-full bg-[#161924] border border-white/15 rounded-xl px-3.5 py-2.5 text-xs text-white font-mono placeholder-gray-500 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-all"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <button
                onClick={handleDetectUserVc}
                disabled={detectingUser || !userId.trim()}
                className="w-full py-2.5 rounded-xl bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white font-bold text-xs shadow-lg shadow-indigo-600/30 flex items-center justify-center gap-2 active:scale-98 transition-all disabled:opacity-50"
              >
                {detectingUser ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Scanning Servers...
                  </>
                ) : (
                  <>
                    <Sparkles className="w-4 h-4" />
                    Find & Join My VC
                  </>
                )}
              </button>

              <button
                onClick={handleSaveSettings}
                disabled={loading}
                className="w-full py-2.5 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-gray-200 font-semibold text-xs flex items-center justify-center gap-1.5 active:scale-98 transition-all"
              >
                <Save className="w-3.5 h-3.5" />
                Save User ID
              </button>
            </div>
          </div>
        </div>

        {/* Card 2: Manual Server & Voice Channel Selector */}
        <div className="p-5 rounded-2xl bg-white/[0.02] border border-white/10 flex flex-col justify-between space-y-4">
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm font-bold text-white flex items-center gap-2">
                <Server className="w-4 h-4 text-cyan-400" />
                Manual Voice Channel Selector
              </span>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 font-semibold">
                {guilds.length} Servers Available
              </span>
            </div>
            <p className="text-xs text-gray-300">
              Pick any server and voice channel available to the streamer account. No one has to be in the VC for the streamer to join.
            </p>
          </div>

          <div className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {/* Server Dropdown */}
              <div>
                <label className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider block mb-1.5">
                  Select Server
                </label>
                <select
                  value={selectedGuildId || (currentGuild?.id ?? '')}
                  onChange={(e) => {
                    setSelectedGuildId(e.target.value);
                    const g = guilds.find((x) => x.id === e.target.value);
                    if (g?.voiceChannels?.[0]) setSelectedVcId(g.voiceChannels[0].id);
                  }}
                  className="w-full bg-[#161924] border border-white/15 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-cyan-500"
                >
                  {guilds.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name}
                    </option>
                  ))}
                </select>
              </div>

              {/* Voice Channel Dropdown */}
              <div>
                <label className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider block mb-1.5">
                  Select Voice Channel
                </label>
                <select
                  value={selectedVcId}
                  onChange={(e) => setSelectedVcId(e.target.value)}
                  className="w-full bg-[#161924] border border-white/15 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-cyan-500"
                >
                  {voiceChannels.map((vc: any) => (
                    <option key={vc.id} value={vc.id}>
                      🔊 #{vc.name} {vc.userCount > 0 ? `(${vc.userCount} users)` : '(0 users)'}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <button
              onClick={handleJoinSelectedVc}
              disabled={loading}
              className="w-full py-2.5 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white font-bold text-xs shadow-lg shadow-cyan-600/30 flex items-center justify-center gap-2 active:scale-98 transition-all disabled:opacity-50"
            >
              <Radio className="w-4 h-4" />
              Join Selected Voice Channel Now
            </button>
          </div>
        </div>
      </div>

      {/* SECTION 3: PLAYBACK DEFAULTS */}
      <div className="p-5 rounded-2xl bg-white/[0.02] border border-white/10 space-y-4">
        <div className="flex items-center gap-2 text-sm font-bold text-white">
          <Tv className="w-4 h-4 text-indigo-400" />
          Default Streaming Preferences
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <div>
            <label className="text-xs text-gray-400 block mb-1">Default Quality</label>
            <select
              value={defaultQuality}
              onChange={(e) => setDefaultQuality(e.target.value)}
              className="w-full bg-[#161924] border border-white/10 rounded-xl px-3 py-2 text-xs text-white"
            >
              <option value="1080p">1080p FHD (Recommended)</option>
              <option value="4k">4K UHD</option>
              <option value="2k">2K QHD</option>
              <option value="720p">720p HD</option>
            </select>
          </div>

          <div>
            <label className="text-xs text-gray-400 block mb-1">Intermission Break</label>
            <select
              value={intermissionSeconds}
              onChange={(e) => setIntermissionSeconds(parseInt(e.target.value, 10))}
              className="w-full bg-[#161924] border border-white/10 rounded-xl px-3 py-2 text-xs text-white"
            >
              <option value={120}>2 Minutes (Standard)</option>
              <option value={60}>1 Minute</option>
              <option value={180}>3 Minutes</option>
              <option value={300}>5 Minutes</option>
              <option value={0}>0 Seconds (Instant Next)</option>
            </select>
          </div>

          <div className="flex items-end">
            <button
              onClick={handleSaveSettings}
              disabled={loading}
              className="w-full py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs shadow-md active:scale-98 transition-all"
            >
              Save All Preferences
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
