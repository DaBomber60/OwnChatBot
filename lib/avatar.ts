/** Client-safe helpers for character and group display pictures. */

/** Longest prompt accepted for AI picture generation. */
export const IMAGE_PROMPT_MAX = 2048;

export interface AvatarOwner {
  id: number;
  avatarUpdatedAt?: string | Date | null;
}

export interface CharacterAvatarSource extends AvatarOwner {
  group?: AvatarOwner | null;
}

function versionedUrl(path: string, owner: AvatarOwner | null | undefined): string | null {
  if (!owner?.avatarUpdatedAt) return null;
  const version = new Date(owner.avatarUpdatedAt).getTime();
  return Number.isFinite(version) ? `${path}?v=${version}` : null;
}

export function groupAvatarUrl(group: AvatarOwner | null | undefined): string | null {
  return group ? versionedUrl(`/api/character-groups/${group.id}/avatar`, group) : null;
}

/** The character's own picture, else its group's picture, else null (callers show initials). */
export function characterAvatarUrl(
  character: CharacterAvatarSource | null | undefined,
  group: AvatarOwner | null | undefined = character?.group,
): string | null {
  if (!character) return null;
  return versionedUrl(`/api/characters/${character.id}/avatar`, character) ?? groupAvatarUrl(group);
}

/** Two-letter monogram from a name, ignoring punctuation like quotes. */
export function initials(name: string): string {
  const words = name.split(/\s+/).map(w => w.replace(/[^\p{L}\p{N}]/gu, '')).filter(Boolean);
  if (words.length === 0) return '?';
  const first = Array.from(words[0]!)[0]!;
  const last = words.length > 1 ? Array.from(words[words.length - 1]!)[0]! : '';
  return (first + last).toUpperCase();
}

/** Stable per-name gradient so the same character always gets the same colour. */
export function avatarGradient(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  const hue = Math.abs(hash) % 360;
  return `linear-gradient(135deg, hsl(${hue} 70% 58%), hsl(${(hue + 40) % 360} 65% 38%))`;
}
