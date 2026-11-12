export interface UserProfile {
  id: string;
  name: string;
  avatar: string;
  color: string;
  defaultAudio: 'VOSTFR' | 'VF';
  isKid?: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface AvatarPreset {
  id: string;
  label: string;
  theme: string;
  color: string;
  emoji: string;
}

export const AVATAR_PRESETS: AvatarPreset[] = [
  { id: 'pirate', label: 'Pirate', theme: 'Chapeau de Paille', color: '#EF4444', emoji: '🏴‍☠️' },
  { id: 'shinobi', label: 'Shinobi', theme: 'Feuille Cachée', color: '#F97316', emoji: '🦊' },
  { id: 'sorcerer', label: 'Exorciste', theme: 'Énergie Occulte', color: '#8B5CF6', emoji: '👁️' },
  { id: 'slayer', label: 'Pourfendeur', theme: 'Souffle du Soleil', color: '#10B981', emoji: '⚔️' },
  { id: 'titan', label: 'Bataillon', theme: 'Ailes de la Liberté', color: '#3B82F6', emoji: '🦅' },
  { id: 'alchemist', label: 'Alchimiste', theme: 'Acier & Transmutation', color: '#F59E0B', emoji: '⚡' },
  { id: 'hunter', label: 'Hunter', theme: 'Nen & Aventure', color: '#06B6D4', emoji: '🎣' },
  { id: 'kuro', label: 'KuroStream', theme: 'Signature Sombre', color: '#FF5E1A', emoji: '🔥' },
  { id: 'cyber', label: 'Cyberpunk', theme: 'Néo-Tokyo 2077', color: '#EC4899', emoji: '🦾' },
  { id: 'mecha', label: 'Mecha', theme: 'Pilote Stellaire', color: '#6366F1', emoji: '🤖' },
];

export const PROFILE_COLORS = [
  '#FF5E1A',
  '#EF4444',
  '#F97316',
  '#F59E0B',
  '#10B981',
  '#06B6D4',
  '#3B82F6',
  '#8B5CF6',
  '#EC4899',
  '#64748B',
];
