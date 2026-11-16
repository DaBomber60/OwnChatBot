import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import useSWR from 'swr';
import { Modal } from './Modal';
import { Avatar } from './Avatar';
import { useToast } from './ToastProvider';
import { extractErrorFromResponse } from '../lib/chat/errorUtils';
import { fetcher } from '../lib/fetcher';
import { IMAGE_PROMPT_MAX } from '../lib/avatar';

/** Side of the on-screen crop square, in CSS pixels. */
const VIEWPORT = 240;
/** Side of the saved picture, in pixels (sharp on high-DPI screens at the sizes we display). */
const OUTPUT = 256;
const MAX_ZOOM = 4;
const MAX_SOURCE_BYTES = 20 * 1024 * 1024;

interface Crop {
  zoom: number;
  x: number;
  y: number;
}

interface LoadedImage {
  element: HTMLImageElement;
  url: string;
  /** Scale at zoom 1, where the shorter side exactly covers the viewport. */
  baseScale: number;
}

function clampCrop(image: LoadedImage, crop: Crop): Crop {
  const zoom = Math.min(MAX_ZOOM, Math.max(1, crop.zoom));
  const scale = image.baseScale * zoom;
  const width = image.element.naturalWidth * scale;
  const height = image.element.naturalHeight * scale;
  return {
    zoom,
    x: Math.min(0, Math.max(VIEWPORT - width, crop.x)),
    y: Math.min(0, Math.max(VIEWPORT - height, crop.y)),
  };
}

/** Changes zoom while keeping the point under the viewport centre fixed. */
function zoomAroundCentre(image: LoadedImage, crop: Crop, zoom: number): Crop {
  const oldScale = image.baseScale * crop.zoom;
  const newZoom = Math.min(MAX_ZOOM, Math.max(1, zoom));
  const newScale = image.baseScale * newZoom;
  const centreX = (VIEWPORT / 2 - crop.x) / oldScale;
  const centreY = (VIEWPORT / 2 - crop.y) / oldScale;
  return clampCrop(image, { zoom: newZoom, x: VIEWPORT / 2 - centreX * newScale, y: VIEWPORT / 2 - centreY * newScale });
}

function canvasBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise(resolve => canvas.toBlob(resolve, type, quality));
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

function dataUrlToFile(dataUrl: string, name: string): File {
  const match = /^data:(image\/[a-z0-9.+-]+);base64,(.+)$/i.exec(dataUrl);
  if (!match) throw new Error('The generated picture could not be read');
  const binary = atob(match[2]!);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new File([bytes], name, { type: match[1] });
}

async function renderCrop(image: LoadedImage, crop: Crop): Promise<string> {
  const canvas = document.createElement('canvas');
  canvas.width = OUTPUT;
  canvas.height = OUTPUT;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas is not available in this browser');
  ctx.imageSmoothingQuality = 'high';

  const scale = image.baseScale * crop.zoom;
  const side = VIEWPORT / scale;
  const draw = () => ctx.drawImage(image.element, -crop.x / scale, -crop.y / scale, side, side, 0, 0, OUTPUT, OUTPUT);

  draw();
  const webp = await canvasBlob(canvas, 'image/webp', 0.9);
  if (webp?.type === 'image/webp') return blobToDataUrl(webp);

  // Browsers without WebP encoding: JPEG has no transparency, so flatten onto white first.
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, OUTPUT, OUTPUT);
  draw();
  const jpeg = await canvasBlob(canvas, 'image/jpeg', 0.9);
  if (!jpeg) throw new Error('Could not encode the picture');
  return blobToDataUrl(jpeg);
}

interface AvatarEditorProps {
  /** Modal title, e.g. "Picture for Aria". */
  title: string;
  /** Name used for the initials preview. */
  name: string;
  /** The owner's own picture, if it has one. */
  currentSrc: string | null;
  /** What is shown when the owner has no picture of its own (e.g. its group's picture). */
  fallbackSrc?: string | null;
  /** Explains the fallback shown when no picture is set. */
  fallbackNote?: string;
  /** Optional context shown above the editor. */
  description?: string;
  /** Avatar API route accepting PUT { image } and DELETE. */
  endpoint: string;
  /** Character whose personality can be turned into a picture prompt with one click. */
  autoGenerateCharacterId?: number;
  onClose: () => void;
  /** Called with the new avatarUpdatedAt (null when removed). */
  onSaved: (avatarUpdatedAt: string | null) => void;
}

export function AvatarEditor({
  title, name, currentSrc, fallbackSrc, fallbackNote, description, endpoint, autoGenerateCharacterId, onClose, onSaved,
}: AvatarEditorProps) {
  const { showToast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ pointerId: number; startX: number; startY: number; crop: Crop } | null>(null);
  const [image, setImage] = useState<LoadedImage | null>(null);
  const [crop, setCrop] = useState<Crop>({ zoom: 1, x: 0, y: 0 });
  const [busy, setBusy] = useState<'saving' | 'removing' | 'generating-auto' | 'generating-prompt' | null>(null);
  const [dropActive, setDropActive] = useState(false);
  const [prompt, setPrompt] = useState('');
  const generationRef = useRef<AbortController | null>(null);
  const promptId = useId();
  // Offered only once a Cloudflare account ID and API token are saved in Settings.
  const { data: imageGeneration } = useSWR<{ configured?: boolean }>('/api/images/generate', fetcher);
  const canGenerate = imageGeneration?.configured === true;
  // Saving or removing can't be interrupted; a picture being generated can.
  const locked = busy === 'saving' || busy === 'removing';
  const generating = busy === 'generating-auto' || busy === 'generating-prompt';

  useEffect(() => () => { if (image) URL.revokeObjectURL(image.url); }, [image]);
  useEffect(() => () => generationRef.current?.abort(), []);

  const loadFile = useCallback((file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      showToast('Choose an image file (PNG, JPEG, WebP or GIF)', 'error');
      return;
    }
    if (file.size > MAX_SOURCE_BYTES) {
      showToast('That image is over 20MB. Choose a smaller one.', 'error');
      return;
    }
    const url = URL.createObjectURL(file);
    const element = new Image();
    element.onload = () => {
      const baseScale = VIEWPORT / Math.min(element.naturalWidth, element.naturalHeight);
      const loaded = { element, url, baseScale };
      setImage(loaded);
      setCrop(clampCrop(loaded, {
        zoom: 1,
        x: (VIEWPORT - element.naturalWidth * baseScale) / 2,
        y: (VIEWPORT - element.naturalHeight * baseScale) / 2,
      }));
    };
    element.onerror = () => {
      URL.revokeObjectURL(url);
      showToast("Couldn't read that image. Try a PNG, JPEG or WebP file.", 'error');
    };
    element.src = url;
  }, [showToast]);

  // React registers wheel listeners as passive, so zoom-on-scroll needs a native listener to stop page scrolling.
  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport || !image) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      setCrop(c => zoomAroundCentre(image, c, c.zoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1)));
    };
    viewport.addEventListener('wheel', onWheel, { passive: false });
    return () => viewport.removeEventListener('wheel', onWheel);
  }, [image]);

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (!image || e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = { pointerId: e.pointerId, startX: e.clientX, startY: e.clientY, crop };
  };

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!image || !drag || drag.pointerId !== e.pointerId) return;
    setCrop(clampCrop(image, { ...drag.crop, x: drag.crop.x + e.clientX - drag.startX, y: drag.crop.y + e.clientY - drag.startY }));
  };

  const endDrag = (e: PointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.pointerId === e.pointerId) dragRef.current = null;
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!image) return;
    const step = e.shiftKey ? 20 : 5;
    const moves: Record<string, [number, number]> = { ArrowLeft: [step, 0], ArrowRight: [-step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] };
    const move = moves[e.key];
    if (move) {
      e.preventDefault();
      setCrop(c => clampCrop(image, { ...c, x: c.x + move[0], y: c.y + move[1] }));
    } else if (e.key === '+' || e.key === '=') {
      e.preventDefault();
      setCrop(c => zoomAroundCentre(image, c, c.zoom + 0.1));
    } else if (e.key === '-') {
      e.preventDefault();
      setCrop(c => zoomAroundCentre(image, c, c.zoom - 0.1));
    }
  };

  const request = async (method: 'PUT' | 'DELETE', body?: unknown) => {
    const res = await fetch(endpoint, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      const errData = await res.json().catch(() => null);
      throw new Error(extractErrorFromResponse(errData, res.statusText));
    }
    return res.status === 204 ? null : res.json();
  };

  const save = async () => {
    if (!image) return;
    setBusy('saving');
    try {
      const dataUrl = await renderCrop(image, crop);
      const result = await request('PUT', { image: dataUrl });
      onSaved(result.avatarUpdatedAt);
      showToast('Picture saved', 'success');
      onClose();
    } catch (err) {
      showToast(`Could not save picture: ${err instanceof Error ? err.message : 'unknown error'}`, 'error');
      setBusy(null);
    }
  };

  const remove = async () => {
    setBusy('removing');
    try {
      await request('DELETE');
      onSaved(null);
      showToast('Picture removed', 'success');
      onClose();
    } catch (err) {
      showToast(`Could not remove picture: ${err instanceof Error ? err.message : 'unknown error'}`, 'error');
      setBusy(null);
    }
  };

  /** Auto mode asks the server to describe the character from its personality. */
  const generate = async (mode: 'auto' | 'prompt') => {
    const text = prompt.trim();
    if (busy || (mode === 'prompt' ? !text : !autoGenerateCharacterId)) return;
    const controller = new AbortController();
    generationRef.current = controller;
    setBusy(mode === 'auto' ? 'generating-auto' : 'generating-prompt');
    try {
      const res = await fetch('/api/images/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(mode === 'auto' ? { characterId: autoGenerateCharacterId } : { prompt: text }),
        signal: controller.signal,
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => null);
        throw new Error(extractErrorFromResponse(errData, res.statusText));
      }
      const { image: dataUrl } = await res.json();
      loadFile(dataUrlToFile(dataUrl, 'generated-picture'));
    } catch (err) {
      if (!controller.signal.aborted) {
        showToast(`Could not generate a picture: ${err instanceof Error ? err.message : 'unknown error'}`, 'error');
      }
    } finally {
      if (generationRef.current === controller) {
        generationRef.current = null;
        setBusy(null);
      }
    }
  };

  const close = () => {
    generationRef.current?.abort();
    onClose();
  };

  const scale = image ? image.baseScale * crop.zoom : 1;

  return (
    <Modal
      open
      onClose={locked ? () => {} : close}
      title={title}
      maxWidth="420px"
      contentClassName="avatar-editor-modal"
      closeOnOverlayClick={false}
      footer={
        <>
          {currentSrc && !image && (
            <button className="btn btn-danger avatar-editor-remove" onClick={remove} disabled={!!busy}>
              {busy === 'removing' ? 'Removing...' : 'Remove picture'}
            </button>
          )}
          <button className="btn btn-secondary" onClick={close} disabled={locked}>Cancel</button>
          <button className="btn btn-primary" onClick={save} disabled={!image || !!busy}>
            {busy === 'saving' ? 'Saving...' : 'Save picture'}
          </button>
        </>
      }
    >
      {description && <p className="text-sm text-secondary avatar-editor-description">{description}</p>}

      <input
        ref={fileInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        className="avatar-editor-file"
        onChange={e => { loadFile(e.target.files?.[0]); e.target.value = ''; }}
      />

      {image ? (
        <div className="avatar-editor">
          <div
            ref={viewportRef}
            className="avatar-crop"
            style={{ width: VIEWPORT, height: VIEWPORT }}
            tabIndex={0}
            role="group"
            aria-label="Picture crop area. Drag or use the arrow keys to move the picture, plus and minus to zoom."
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            onKeyDown={onKeyDown}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={image.url}
              alt=""
              draggable={false}
              className="avatar-crop-image"
              style={{
                width: image.element.naturalWidth * scale,
                height: image.element.naturalHeight * scale,
                transform: `translate(${crop.x}px, ${crop.y}px)`,
              }}
            />
            <div className="avatar-crop-mask" aria-hidden="true" />
          </div>
          <label className="avatar-zoom">
            <span className="text-sm text-secondary">Zoom</span>
            <input
              type="range"
              className="form-range"
              min={1}
              max={MAX_ZOOM}
              step={0.01}
              value={crop.zoom}
              onChange={e => setCrop(c => zoomAroundCentre(image, c, Number(e.target.value)))}
              disabled={!!busy}
            />
          </label>
          <p className="text-xs text-muted avatar-editor-hint">Drag to reposition. Scroll or use the slider to zoom.</p>
          <div className="avatar-editor-actions">
            <button type="button" className="btn btn-secondary btn-small" onClick={() => fileInputRef.current?.click()} disabled={!!busy}>
              Choose a different image
            </button>
            {canGenerate && (
              <button type="button" className="btn btn-secondary btn-small" onClick={() => setImage(null)} disabled={!!busy}>
                ✨ Generate a different one
              </button>
            )}
          </div>
        </div>
      ) : (
        <>
        <div
          className={`avatar-editor avatar-drop${dropActive ? ' avatar-drop-active' : ''}`}
          onDragOver={e => { e.preventDefault(); setDropActive(true); }}
          onDragLeave={() => setDropActive(false)}
          onDrop={e => { e.preventDefault(); setDropActive(false); if (!busy) loadFile(e.dataTransfer.files?.[0]); }}
        >
          <Avatar name={name} src={currentSrc ?? fallbackSrc} size="7rem" />
          <p className="text-sm text-secondary avatar-editor-status">
            {currentSrc ? 'Current picture' : fallbackSrc ? fallbackNote ?? 'Using a fallback picture' : 'No picture yet. Initials are shown instead.'}
          </p>
          <button type="button" className="btn btn-primary" onClick={() => fileInputRef.current?.click()} disabled={!!busy}>
            {currentSrc ? 'Choose a new image' : 'Choose an image'}
          </button>
          <p className="text-xs text-muted avatar-editor-hint">or drop one here · PNG, JPEG, WebP or GIF</p>
        </div>
        {canGenerate && (
          <div className="avatar-generate">
            <div className="avatar-generate-divider" aria-hidden="true"><span>or generate one</span></div>
            {autoGenerateCharacterId && (
              <>
                <button type="button" className="btn btn-primary" onClick={() => generate('auto')} disabled={!!busy}>
                  {busy === 'generating-auto' ? (
                <>
                  <span className="loading-spinner" aria-hidden="true" />
                  Generating…
                </>
              ) : '✨ Auto-generate from personality'}
                </button>
                <p className="text-xs text-muted avatar-editor-hint">Describes the character using their personality.</p>
              </>
            )}
            <label className="form-label avatar-generate-label" htmlFor={promptId}>
              {autoGenerateCharacterId ? 'Or write your own prompt' : 'Describe the picture'}
            </label>
            <textarea
              id={promptId}
              className="form-textarea avatar-generate-prompt"
              rows={3}
              maxLength={IMAGE_PROMPT_MAX}
              value={prompt}
              onChange={e => setPrompt(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); generate('prompt'); } }}
              placeholder="e.g. head-and-shoulders portrait, silver hair, soft window light"
              disabled={generating}
            />
            <button type="button" className="btn btn-secondary" onClick={() => generate('prompt')} disabled={!prompt.trim() || !!busy}>
              {busy === 'generating-prompt' ? (
                <>
                  <span className="loading-spinner" aria-hidden="true" />
                  Generating…
                </>
              ) : 'Generate from prompt'}
            </button>
            <p className="text-xs text-muted avatar-editor-hint" aria-live="polite">
              {generating
                ? 'This can take a little while. You can crop the result before saving.'
                : 'Made with FLUX.2 [klein] on Cloudflare Workers AI. You can crop the result before saving.'}
            </p>
          </div>
        )}
        </>
      )}
    </Modal>
  );
}
