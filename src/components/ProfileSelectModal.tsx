import { useState } from 'react';
import { Edit3, Plus, X, Check } from 'lucide-react';
import type { UserProfile } from '../types/profile';
import { ProfileAvatar } from './ProfileAvatar';
import { ProfileEditModal } from './ProfileEditModal';

interface ProfileSelectModalProps {
  profiles: UserProfile[];
  activeProfileId: string;
  canClose?: boolean;
  onSelectProfile: (profileId: string) => void;
  onCreateProfile: (data: {
    name: string;
    avatar: string;
    color: string;
    defaultAudio: 'VOSTFR' | 'VF';
    isKid: boolean;
  }) => Promise<UserProfile>;
  onUpdateProfile: (profileId: string, patch: Partial<UserProfile>) => Promise<void>;
  onDeleteProfile: (profileId: string) => Promise<void>;
  onClose: () => void;
}

export function ProfileSelectModal({
  profiles,
  activeProfileId,
  canClose = true,
  onSelectProfile,
  onCreateProfile,
  onUpdateProfile,
  onDeleteProfile,
  onClose,
}: ProfileSelectModalProps) {
  const [managing, setManaging] = useState(false);
  const [editingProfile, setEditingProfile] = useState<UserProfile | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);

  return (
    <div
      className="fixed inset-0 z-50 bg-[#0B0C10]/95 backdrop-blur-2xl flex flex-col items-center justify-center p-4 overflow-y-auto animate-fadeIn"
      onClick={(e) => {
        if (canClose && e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-4xl flex flex-col items-center my-auto py-8">
        {/* Top close button (only if canClose is true) */}
        {canClose ? (
          <div className="w-full flex justify-end mb-4">
            <button
              type="button"
              onClick={onClose}
              aria-label="Fermer"
              className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl bg-white/6 hover:bg-white/12 text-zinc-300 hover:text-white transition-colors cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        ) : (
          <div className="h-4" />
        )}

        <h1 className="text-3xl sm:text-5xl font-display font-bold text-white tracking-tight mb-3 text-center">
          {managing ? 'Gérer les profils' : 'Qui regarde ?'}
        </h1>
        <p className="text-sm sm:text-base text-zinc-400 mb-10 text-center max-w-md">
          {managing
            ? 'Sélectionnez un profil pour modifier son nom, son avatar ou le supprimer.'
            : 'Chaque profil conserve sa propre liste d’animés et son suivi d’épisodes indépendant.'}
        </p>

        {/* Profiles Grid */}
        <div className="flex flex-wrap items-center justify-center gap-6 sm:gap-10 mb-10">
          {profiles.map((p) => {
            const isActive = p.id === activeProfileId;
            return (
              <div key={p.id} className="flex flex-col items-center group relative">
                <button
                  type="button"
                  onClick={() => {
                    if (managing) {
                      setEditingProfile(p);
                    } else {
                      onSelectProfile(p.id);
                      onClose();
                    }
                  }}
                  className={`relative p-1.5 rounded-3xl transition-transform duration-200 cursor-pointer ${
                    managing
                      ? 'hover:scale-105 opacity-90 hover:opacity-100'
                      : 'hover:scale-105 active:scale-95'
                  }`}
                >
                  <ProfileAvatar avatar={p.avatar} color={p.color} size="xl" />

                  {/* Active indicator */}
                  {!managing && isActive ? (
                    <span className="absolute -top-1.5 -right-1.5 w-6 h-6 rounded-full bg-[#FF5E1A] border-2 border-[#111319] flex items-center justify-center text-white text-xs shadow-md">
                      <Check className="w-3.5 h-3.5 stroke-[3]" />
                    </span>
                  ) : null}

                  {/* Edit overlay in managing mode */}
                  {managing ? (
                    <div className="absolute inset-0 bg-black/60 rounded-3xl flex items-center justify-center text-white backdrop-blur-[2px] transition-opacity">
                      <div className="w-10 h-10 rounded-full bg-white/20 border border-white/40 flex items-center justify-center shadow-lg">
                        <Edit3 className="w-5 h-5" />
                      </div>
                    </div>
                  ) : null}
                </button>

                <div className="mt-3 text-center">
                  <span className="block text-sm sm:text-base font-semibold text-zinc-200 group-hover:text-white transition-colors truncate max-w-[130px]">
                    {p.name}
                  </span>
                  <span className="inline-block text-[11px] font-mono text-zinc-500 uppercase tracking-wider mt-0.5">
                    {p.defaultAudio}
                  </span>
                </div>
              </div>
            );
          })}

          {/* Add Profile Card */}
          {profiles.length < 6 ? (
            <div className="flex flex-col items-center group">
              <button
                type="button"
                onClick={() => setShowCreateModal(true)}
                className="w-24 h-24 sm:w-28 sm:h-28 rounded-3xl border-2 border-dashed border-white/20 hover:border-white/50 bg-white/[0.02] hover:bg-white/[0.08] flex items-center justify-center text-zinc-400 group-hover:text-white transition-all cursor-pointer hover:scale-105"
                title="Ajouter un profil"
              >
                <Plus className="w-9 h-9 stroke-[1.5]" />
              </button>
              <span className="mt-3 text-xs sm:text-sm font-medium text-zinc-400 group-hover:text-white transition-colors">
                Ajouter un profil
              </span>
            </div>
          ) : null}
        </div>

        {/* Manage / Done button */}
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setManaging((prev) => !prev)}
            className={`px-6 py-2.5 rounded-xl text-xs sm:text-sm font-semibold tracking-wide uppercase transition-all cursor-pointer ${
              managing
                ? 'bg-white text-black hover:bg-zinc-200 shadow-lg'
                : 'bg-white/8 hover:bg-white/14 text-zinc-300 hover:text-white border border-white/15'
            }`}
          >
            {managing ? 'Terminer' : 'Gérer les profils'}
          </button>
        </div>
      </div>

      {/* Edit existing profile modal */}
      {editingProfile ? (
        <ProfileEditModal
          profileToEdit={editingProfile}
          canDelete={profiles.length > 1}
          onSave={async (data) => {
            await onUpdateProfile(editingProfile.id, data);
            setEditingProfile(null);
          }}
          onDelete={async (pid) => {
            await onDeleteProfile(pid);
            setEditingProfile(null);
          }}
          onClose={() => setEditingProfile(null)}
        />
      ) : null}

      {/* Create new profile modal */}
      {showCreateModal ? (
        <ProfileEditModal
          profileToEdit={null}
          canDelete={false}
          onSave={async (data) => {
            await onCreateProfile(data);
            setShowCreateModal(false);
          }}
          onClose={() => setShowCreateModal(false)}
        />
      ) : null}
    </div>
  );
}
