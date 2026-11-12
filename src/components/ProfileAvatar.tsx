import { AVATAR_PRESETS } from '../types/profile';

interface ProfileAvatarProps {
  avatar: string;
  color?: string;
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
}

export function ProfileAvatar({
  avatar,
  color = '#FF5E1A',
  size = 'md',
  className = '',
}: ProfileAvatarProps) {
  const preset = AVATAR_PRESETS.find((p) => p.id === avatar) ?? AVATAR_PRESETS[0];

  const sizeClasses = {
    xs: 'w-6 h-6 text-xs rounded-md',
    sm: 'w-8 h-8 text-sm rounded-lg',
    md: 'w-10 h-10 text-base rounded-xl',
    lg: 'w-16 h-16 text-2xl rounded-2xl',
    xl: 'w-24 h-24 sm:w-28 sm:h-28 text-4xl sm:text-5xl rounded-3xl',
  }[size];

  return (
    <div
      className={`relative flex items-center justify-center font-bold text-white shrink-0 shadow-lg select-none transition-transform ${sizeClasses} ${className}`}
      style={{
        background: `linear-gradient(135deg, ${color}dd 0%, #111319 100%)`,
        border: `2px solid ${color}88`,
        boxShadow: `0 4px 20px ${color}33`,
      }}
    >
      <span className="drop-shadow-md leading-none">{preset.emoji}</span>
    </div>
  );
}
