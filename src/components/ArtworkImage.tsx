import { useState } from 'react';
import { Film } from 'lucide-react';

interface ArtworkImageProps {
  src: string;
  alt: string;
  className?: string;
  accentTint?: string;
  title?: string;
}

export function ArtworkImage({
  src,
  alt,
  className = '',
  accentTint = '#FF5E1A',
  title,
}: ArtworkImageProps) {
  const [hasError, setHasError] = useState(false);

  if (hasError || !src) {
    return (
      <div
        className={`flex flex-col items-center justify-center bg-[#151821] text-zinc-400 p-4 select-none ${className}`}
        style={{
          backgroundImage: `radial-gradient(circle at 30% 25%, ${accentTint}26, transparent 60%)`,
        }}
      >
        <Film className="w-7 h-7 mb-2 opacity-60" />
        {title ? (
          <span className="text-xs font-medium text-zinc-300 text-center line-clamp-2">
            {title}
          </span>
        ) : null}
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={alt}
      referrerPolicy="no-referrer"
      onError={() => setHasError(true)}
      className={className}
    />
  );
}
