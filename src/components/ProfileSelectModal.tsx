import { useState } from 'react';
import { Edit3, Plus, X, LogIn, LogOut, Loader2 } from 'lucide-react';
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
  /** Compte Google connecté → mêmes profils sur tous les appareils */
  isGoogleUser?: boolean;
  accountLabel?: string | null;
  authBusy?: boolean;
  authError?: string | null;
  onSignInWithGoogle?: () => Promise<void>;
  onSignOut?: () => Promise<void>;
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
  isGoogleUser = false,
  accountLabel = null,
  authBusy = false,
  authError = null,
  onSignInWithGoogle,
  onSignOut,
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
        <p className="text-sm sm:text-base text-zinc-400 mb-6 text-center max-w-md">
          {managing
            ? 'Sélectionnez un profil pour modifier son nom, son avatar ou le supprimer.'
            : 'Chaque profil a sa propre liste et sa progression.'}
        </p>

        {/* Compte cloud — synchronisation multi-appareils */}
        <div className="w-full max-w-md mb-8 rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3.5 flex flex-col gap-2.5">
          {isGoogleUser ? (
            <>
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[11px] uppercase tracking-wider text-zinc-500 font-semibold">
                    Compte synchronisé
                  </p>
                  <p className="text-sm text-white truncate">
                    {accountLabel || 'Google'}
                  </p>
                </div>
                {onSignOut ? (
                  <button
                    type="button"
                    disabled={authBusy}
                    onClick={() => void onSignOut()}
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold bg-white/8 hover:bg-white/14 text-zinc-200 border border-white/12 disabled:opacity-50 cursor-pointer"
                  >
                    {authBusy ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <LogOut className="w-3.5 h-3.5" />
                    )}
                    Déconnexion
                  </button>
                ) : null}
              </div>
              <p className="text-[11px] text-zinc-500 leading-relaxed">
                Tes profils, watchlist et progression sont liés à ce compte et disponibles sur tous tes appareils.
              </p>
            </>
          ) : (
            <>
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[11px] uppercase tracking-wider text-zinc-500 font-semibold">
                    Mode invité (cet appareil)
                  </p>
                  <p className="text-sm text-zinc-300">
                    Connecte-toi pour retrouver tes profils partout
                  </p>
                </div>
                {onSignInWithGoogle ? (
                  <button
                    type="button"
                    disabled={authBusy}
                    onClick={() => void onSignInWithGoogle()}
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold bg-white text-black hover:bg-zinc-200 disabled:opacity-50 cursor-pointer shrink-0"
                  >
                    {authBusy ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <LogIn className="w-3.5 h-3.5" />
                    )}
                    Google
                  </button>
                ) : null}
              </div>
              <p className="text-[11px] text-zinc-500 leading-relaxed">
                Sans connexion, les profils restent locaux à cet appareil. Avec Google, le même profil suit sur téléphone, PC, etc.
              </p>
            </>
          )}
          {authError ? (
            <p className="text-[11px] text-amber-300/90 leading-relaxed">{authError}</p>
          ) : null}
        </div>

        {/* Profiles Grid */}
        <div className="flex flex-wrap justify-center gap-6 sm:gap-8 mb-10 max-w-3xl">
          {profiles.map((p) => {
            const isActive = p.id === activeProfileId;
            return (
              <div key={p.id} className="flex flex-col items-center group">
                <button
                  type="button"
                  onClick={() => {
                    if (managing) {
                      setEditingProfile(p);
                    } else {
                      onSelectProfile(p.id);
                    }
                  }}
                  className={`relative rounded-3xl transition-all cursor-pointer hover:scale-105 ${
                    isActive && !managing
                      ? 'ring-2 ring-[#FF5E1A] ring-offset-2 ring-offset-[#0B0C10]'
                      : ''
                  }`}
                  title={managing ? `Modifier ${p.name}` : `Regarder en tant que ${p.name}`}
                >
                  <ProfileAvatar avatar={p.avatar} color={p.color} size="xl" />
                  {managing ? (
                    <span className="absolute -bottom-1 -right-1 w-8 h-8 rounded-full bg-[#FF5E1A] text-white flex items-center justify-center shadow-lg border-2 border-[#0B0C10]">
                      <Edit3 className="w-3.5 h-3.5" />
                    </span>
                  ) : null}
                </button>
                <span
                  className={`mt-3 text-xs sm:text-sm font-medium transition-colors max-w-[100px] truncate ${
                    isActive && !managing ? 'text-white' : 'text-zinc-400 group-hover:text-white'
                  }`}
                >
                  {p.name}
                </span>
              </div>
            );
          })}

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
