'use client';

import React, { useState, useEffect } from 'react';
import {
  X,
  Settings,
  Volume2,
  UserCheck,
  Check,
  Radio,
  Tv,
  MessageSquare,
  Clock,
  Sparkles,
  Loader2,
  RefreshCw,
} from 'lucide-react';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onVoiceChannelChanged?: (guildId: string, vcId: string) => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
  onVoiceChannelChanged,
}) => {
  const [guilds, setGuilds] = useState<any[]>([]);
  const [selectedGuildId, setSelectedGuildId] = useState<string>('');
  const [selectedVcId, setSelectedVcId] = useState<string>('');
  const [userId, setUserId] = useState<string>('');
  const [autoFollow, setAutoFollow] = useState<boolean>(false);
  const [defaultQuality, setDefaultQuality] = useState<string>('1080p');
  const [autoEnglishSubs, setAutoEnglishSubs] = useState<boolean>(true);
  const [intermissionSeconds, setIntermissionSeconds] = useState<number>(120);

  const [loading, setLoading] = useState<boolean>(false);
  const [detectingUser, setDetectingUser] = useState<boolean>(false);
  const [statusMessage, setStatusMessage] = useState<string>('');
  const [error, setError] = useState<string>('');

  // Load saved settings & available guilds on modal open
  useEffect(() => {
    if (!isOpen) return;

    const loadData = async () => {
      setLoading(true);
      try {
        // 1. Fetch guilds
        const guildsRes = await fetch('/api/discord/guilds');
        const guildsData = await guildsRes.json();
        setGuilds(guildsData.guilds || []);

        // 2. Fetch settings
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

    loadData();
  }, [isOpen]);

  if (!isOpen) return null;

  const currentGuild = guilds.find((g) => g.id === selectedGuildId) || guilds[0];
  const voiceChannels = currentGuild?.voiceChannels || [];

  // Join selected VC
  const handleJoinSelectedVc = async () => {
    if (!selectedGuildId || !selectedVcId) {
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
        body: JSON.stringify({ guildId: selectedGuildId, voiceChannelId: selectedVcId }),
      });
      const data = await res.json();

      if (data.success) {
        setStatusMessage(`🔊 Streamer joined "${voiceChannels.find((v: any) => v.id === selectedVcId)?.name || 'Voice Channel'}"!`);
        if (onVoiceChannelChanged) onVoiceChannelChanged(selectedGuildId, selectedVcId);
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

        setStatusMessage(`🎯 Found you in "${vs.voiceChannelName}" (${vs.guildName})! Streamer joined your VC.`);
        if (onVoiceChannelChanged) onVoiceChannelChanged(vs.guildId, vs.voiceChannelId);
      } else {
        setError(`User ID not found in any voice channel. Make sure you are sitting in a VC on a shared server.`);
      }
    } catch (err) {
      setError('Error detecting user voice channel');
    } finally {
      setDetectingUser(false);
    }
  };

  // Save general settings
  const handleSaveSettings = async () => {
    setLoading(true);
    setError('');
    setStatusMessage('');

    try {
      await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId,
          autoFollow,
          selectedGuildId,
          selectedVoiceChannelId: selectedVcId,
          defaultQuality,
          autoEnglishSubs,
          intermissionSeconds,
        }),
      });

      setStatusMessage('✅ Settings saved successfully!');
      setTimeout(() => {
        setStatusMessage('');
        onClose();
      }, 1500);
    } catch (err) {
      setError('Failed to save settings');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in fade-in duration-200">
      <div className="w-full max-w-xl glass-panel-glow rounded-3xl p-6 md:p-8 border border-white/20 relative shadow-2xl overflow-hidden max-h-[90vh] overflow-y-auto">
        {/* Ambient Glow */}
        <div className="absolute top-0 right-0 w-60 h-60 bg-indigo-600/20 rounded-full blur-3xl pointer-events-none" />

        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-white/10 mb-6">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-indigo-600 to-indigo-400 flex items-center justify-center text-white shadow-md shadow-indigo-500/20">
              <Settings className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-white text-lg">Cinema & Voice Settings</h3>
              <p className="text-xs text-gray-400">Configure Discord Voice Channel & streaming preferences</p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-2 rounded-xl hover:bg-white/10 text-gray-400 hover:text-white transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Status Alerts */}
        {statusMessage && (
          <div className="mb-4 p-3.5 rounded-xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 text-xs font-semibold flex items-center gap-2 animate-in fade-in">
            <Check className="w-4 h-4" />
            {statusMessage}
          </div>
        )}
        {error && (
          <div className="mb-4 p-3.5 rounded-xl bg-rose-500/15 border border-rose-500/30 text-rose-300 text-xs">
            {error}
          </div>
        )}

        <div className="space-y-6">
          {/* Section 1: Server & Voice Channel Selector */}
          <div className="p-4 rounded-2xl bg-white/[0.02] border border-white/10 space-y-3">
            <div className="flex items-center justify-between text-xs font-semibold text-gray-300">
              <span className="flex items-center gap-1.5">
                <Volume2 className="w-4 h-4 text-indigo-400" />
                Target Server & Voice Channel
              </span>
              <span className="text-[10px] text-gray-400 font-mono">
                {guilds.length} Servers Available
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {/* Server Dropdown */}
              <div>
                <label className="text-[11px] text-gray-400 block mb-1">Select Server</label>
                <select
                  value={selectedGuildId || (currentGuild?.id ?? '')}
                  onChange={(e) => {
                    setSelectedGuildId(e.target.value);
                    const g = guilds.find((x) => x.id === e.target.value);
                    if (g?.voiceChannels?.[0]) setSelectedVcId(g.voiceChannels[0].id);
                  }}
                  className="w-full bg-[#161924] border border-white/10 rounded-xl px-3 py-2 text-xs text-white"
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
                <label className="text-[11px] text-gray-400 block mb-1">Select Voice Channel</label>
                <select
                  value={selectedVcId}
                  onChange={(e) => setSelectedVcId(e.target.value)}
                  className="w-full bg-[#161924] border border-white/10 rounded-xl px-3 py-2 text-xs text-white"
                >
                  {voiceChannels.map((vc: any) => (
                    <option key={vc.id} value={vc.id}>
                      🔊 {vc.name} {vc.userCount > 0 ? `(${vc.userCount} users)` : ''}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <button
              onClick={handleJoinSelectedVc}
              disabled={loading}
              className="w-full py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-medium text-xs flex items-center justify-center gap-1.5 transition-all shadow-md active:scale-98"
            >
              <Radio className="w-3.5 h-3.5" />
              Join Selected Voice Channel
            </button>
          </div>

          {/* Section 2: Auto-Follow User VC Mode ("Follow Me") */}
          <div className="p-4 rounded-2xl bg-indigo-950/30 border border-indigo-500/20 space-y-3">
            <div className="flex items-center justify-between text-xs font-semibold text-indigo-300">
              <span className="flex items-center gap-1.5">
                <UserCheck className="w-4 h-4 text-indigo-400" />
                Auto-Follow User Voice Channel
              </span>
              <span className="text-[10px] text-indigo-400 bg-indigo-500/10 px-2 py-0.5 rounded-full border border-indigo-500/20">
                Follow-Me Mode
              </span>
            </div>

            <p className="text-[11px] text-gray-300">
              Enter your Discord User ID. The streamer bot will automatically find which voice channel you are sitting in across all servers and join it!
            </p>

            <div className="flex gap-2">
              <input
                type="text"
                value={userId}
                onChange={(e) => setUserId(e.target.value)}
                placeholder="e.g. 1544008805094785026"
                className="flex-1 bg-[#161924] border border-white/10 rounded-xl px-3 py-2 text-xs text-white font-mono placeholder-gray-500 focus:outline-none focus:border-indigo-500"
              />
              <button
                onClick={handleDetectUserVc}
                disabled={detectingUser || !userId.trim()}
                className="px-4 py-2 rounded-xl bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white font-medium text-xs flex items-center gap-1.5 transition-all shadow-md active:scale-98 disabled:opacity-50 shrink-0"
              >
                {detectingUser ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Sparkles className="w-3.5 h-3.5" />
                )}
                <span>Find & Join My VC</span>
              </button>
            </div>
          </div>

          {/* Section 3: Playback Defaults */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-semibold text-gray-300 block mb-1.5 flex items-center gap-1">
                <Tv className="w-3.5 h-3.5 text-indigo-400" />
                Default Resolution
              </label>
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
              <label className="text-xs font-semibold text-gray-300 block mb-1.5 flex items-center gap-1">
                <Clock className="w-3.5 h-3.5 text-amber-400" />
                Intermission Break Time
              </label>
              <select
                value={intermissionSeconds}
                onChange={(e) => setIntermissionSeconds(parseInt(e.target.value, 10))}
                className="w-full bg-[#161924] border border-white/10 rounded-xl px-3 py-2 text-xs text-white"
              >
                <option value={60}>1 Minute (60s)</option>
                <option value={120}>2 Minutes (120s - Standard)</option>
                <option value={180}>3 Minutes (180s)</option>
                <option value={300}>5 Minutes (300s)</option>
                <option value={0}>0 Seconds (No Intermission)</option>
              </select>
            </div>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="mt-8 pt-4 border-t border-white/10 flex items-center justify-end gap-2">
          <button
            onClick={onClose}
            className="px-4 py-2.5 rounded-xl hover:bg-white/10 text-xs font-medium text-gray-400 hover:text-white transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSaveSettings}
            disabled={loading}
            className="px-6 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs shadow-lg shadow-indigo-600/30 transition-all active:scale-98 disabled:opacity-50"
          >
            Save Preferences
          </button>
        </div>
      </div>
    </div>
  );
};
