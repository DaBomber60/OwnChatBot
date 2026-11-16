import { useState, type CSSProperties } from 'react';
import { avatarGradient, initials } from '../lib/avatar';

interface AvatarProps {
  /** Used for the initials fallback and its colour. */
  name: string;
  /** Picture URL; initials are shown when absent or when the image fails to load. */
  src?: string | null;
  /** Any CSS length. */
  size?: string;
  className?: string;
  style?: CSSProperties;
  /** Set when the avatar is the only label for something (otherwise it is decorative). */
  label?: string;
}

export function Avatar({ name, src, size = '2.5rem', className, style, label }: AvatarProps) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const showImage = !!src && failedSrc !== src;

  return (
    <span
      className={['avatar', className].filter(Boolean).join(' ')}
      style={{
        width: size,
        height: size,
        fontSize: `calc(${size} * 0.38)`,
        background: showImage ? undefined : avatarGradient(name),
        ...style,
      }}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      title={label}
    >
      {showImage ? (
        // next/image would fetch through the optimizer, which lacks the auth cookie these routes need.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt="" loading="lazy" decoding="async" draggable={false} onError={() => setFailedSrc(src)} />
      ) : (
        initials(name)
      )}
    </span>
  );
}
