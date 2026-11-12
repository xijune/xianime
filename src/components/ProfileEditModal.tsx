import { useState } from 'react';
import { Check, Trash2, X } from 'lucide-react';
import {
  AVATAR_PRESETS,
  PROFILE_COLORS,
  type UserProfile,
} from '../types/profile';
import { ProfileAvatar } from './ProfileAvatar';

interface ProfileEditModalProps {
  profileToEdit?: UserProfile | null; // null means creating a new profile
  onSave: (data: {
    name: string;
    avatar: string;
    color: string;
    defaultAudio: 'VOSTFR' | 'VF';
    isKid: boolean;
  }) => Promise<void>;
  onDelete?: (profileId: string) => Promise<void>;
  onClose: () => void;
  canDelete?: boolean;
}

export function ProfileEditModal({
  profileToEdit,
  onSave,
  onDelete,
  onClose,
  canDelete = false,
}: ProfileEditModalProps) {
  const isEditing = Boolean(profileToEdit);
  const [name, setName] = useState(profileToEdit?.name ?? '');
  const [avatar, setAvatar] = useState(profileToEdit?.avatar ?? 'kuro');
  const [color, setColor] = useState(profileToEdit?.color ?? '#FF5E1A');
  const [defaultAudio, setDefaultAudio] = useState<'VOSTFR' | 'VF'>(
    profileToEdit?.defaultAudio ?? 'VOSTFR'
  );
  const [isKid, setIsKid] = useState(Boolean(profileToEdit?.isKid));
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;

    setSaving(true);
    try {
      await onSave({
        name: trimmed,
        avatar,
        color,
        defaultAudio,
        isKid,
      });
      onClose();
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!profileToEdit || !onDelete) return;
    setSaving(true);
    try {
      await onDelete(profileToEdit.id);
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/85 backdrop-blur-md flex items-center justify-center p-4 overflow-y-auto"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="relative w-full max-w-lg bg-[#111319] border border-white/12 rounded-2xl p-6 sm:p-8 shadow-2xl my-8">
        <button
          type="button"
          onClick={onClose}
          aria-label="Fermer"
          className="absolute top-4 right-4 min-h-[40px] min-w-[40px] flex items-center justify-center rounded-lg text-zinc-400 hover:text-white hover:bg-white/8 transition-colors cursor-pointer"
        >
          <X className="w-5 h-5" />
        </button>

        <h2 className="text-xl sm:text-2xl font-display font-bold text-white mb-6">
          {isEditing ? 'Modifier le profil' : 'Créer un nouveau profil'}
        </h2>

        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Avatar Preview */}
          <div className="flex items-center gap-4 p-4 rounded-xl bg-white/[0.03] border border-white/8">
            <ProfileAvatar avatar={avatar} color={color} size="lg" />
            <div className="min-w-0 flex-1">
              <label htmlFor="profile-name" className="block text-xs text-zinc-400 mb-1 font-medium">
                Nom du profil
              </label>
              <input
                id="profile-name"
                type="text"
                required
                maxLength={40}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Ex: Stefan, Luffy, Zoro..."
                className="w-full px-3 py-2 bg-black/50 border border-white/15 rounded-lg text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-[#FF5E1A] transition-colors"
              />
            </div>
          </div>

          {/* Avatar Selection */}
          <div>
            <span className="block text-xs font-semibold uppercase tracking-wider text-zinc-400 mb-2.5">
              Choisir un avatar d'animé
            </span>
            <div className="grid grid-cols-5 gap-2 sm:gap-2.5">
              {AVATAR_PRESETS.map((p) => {
                const isSelected = avatar === p.id;
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => {
                      setAvatar(p.id);
                      if (!isEditing) setColor(p.color);
                    }}
                    className={`relative p-2 rounded-xl flex flex-col items-center gap-1 border transition-all cursor-pointer ${
                      isSelected
                        ? 'border-[#FF5E1A] bg-[#FF5E1A]/15 scale-105 shadow-md'
                        : 'border-white/8 bg-white/[0.02] hover:bg-white/[0.06] hover:border-white/20'
                    }`}
                  >
                    <span className="text-2xl">{p.emoji}</span>
                    <span className="text-[10px] text-zinc-300 font-medium truncate w-full text-center">
                      {p.label}
                    </span>
                    {isSelected ? (
                      <span className="absolute top-1 right-1 w-3.5 h-3.5 rounded-full bg-[#FF5E1A] flex items-center justify-center text-white">
                        <Check className="w-2.5 h-2.5 stroke-[3]" />
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Accent Color Selection */}
          <div>
            <span className="block text-xs font-semibold uppercase tracking-wider text-zinc-400 mb-2.5">
              Couleur du profil
            </span>
            <div className="flex items-center gap-2 sm:gap-3 flex-wrap">
              {PROFILE_COLORS.map((c) => {
                const isSelected = color === c;
                return (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setColor(c)}
                    className="w-8 h-8 rounded-full border-2 transition-transform cursor-pointer relative flex items-center justify-center"
                    style={{
                      backgroundColor: c,
                      borderColor: isSelected ? '#FFFFFF' : 'transparent',
                      transform: isSelected ? 'scale(1.15)' : 'scale(1)',
                    }}
                    title={c}
                  >
                    {isSelected ? <Check className="w-4 h-4 text-white drop-shadow" /> : null}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Preferred Audio */}
          <div>
            <span className="block text-xs font-semibold uppercase tracking-wider text-zinc-400 mb-2.5">
              Piste audio par défaut pour ce profil
            </span>
            <div className="flex items-center gap-2">
              {(['VOSTFR', 'VF'] as const).map((aud) => (
                <button
                  key={aud}
                  type="button"
                  onClick={() => setDefaultAudio(aud)}
                  className={`flex-1 py-2 px-3 rounded-lg text-xs font-semibold transition-colors cursor-pointer border ${
                    defaultAudio === aud
                      ? 'bg-[#FF5E1A] border-[#FF5E1A] text-white'
                      : 'bg-white/5 border-white/10 text-zinc-400 hover:text-white'
                  }`}
                >
                  {aud === 'VOSTFR' ? 'VOSTFR (Version Originale Sous-Titrée)' : 'VF (Version Française)'}
                </button>
              ))}
            </div>
          </div>

          {/* Action buttons */}
          <div className="pt-4 border-t border-white/10 flex flex-wrap items-center justify-between gap-3">
            {isEditing && canDelete ? (
              confirmDelete ? (
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleDelete}
                    disabled={saving}
                    className="px-3.5 py-2 rounded-lg bg-red-600 hover:bg-red-700 text-white text-xs font-semibold transition-colors cursor-pointer"
                  >
                    Confirmer suppression
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmDelete(false)}
                    className="px-2.5 py-2 rounded-lg bg-white/10 hover:bg-white/15 text-zinc-300 text-xs transition-colors cursor-pointer"
                  >
                    Annuler
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmDelete(true)}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-red-400 hover:text-red-300 hover:bg-red-500/10 text-xs font-medium transition-colors cursor-pointer"
                >
                  <Trash2 className="w-4 h-4" />
                  <span>Supprimer le profil</span>
                </button>
              )
            ) : <div />}

            <div className="flex items-center gap-2 ml-auto">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 rounded-lg bg-white/6 hover:bg-white/10 text-zinc-300 text-xs font-medium transition-colors cursor-pointer"
              >
                Annuler
              </button>
              <button
                type="submit"
                disabled={saving || !name.trim()}
                className="px-5 py-2 rounded-lg bg-[#FF5E1A] hover:bg-[#e85112] text-white text-xs font-semibold transition-colors disabled:opacity-50 cursor-pointer shadow-lg shadow-[#FF5E1A]/20"
              >
                {saving ? 'Enregistrement...' : isEditing ? 'Sauvegarder' : 'Créer le profil'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
