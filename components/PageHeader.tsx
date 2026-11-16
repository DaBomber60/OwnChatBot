import { useRouter } from 'next/router';

interface PageHeaderProps {
  title: string;
  /** Optional parent page, shown as a "← label" button before Home. */
  back?: { href: string; label: string };
}

export function PageHeader({ title, back }: PageHeaderProps) {
  const router = useRouter();
  return (
    <div className="flex items-center justify-between gap-4 mb-6">
      <h1 className="text-3xl font-semibold mb-0" style={{ overflowWrap: 'anywhere' }}>{title}</h1>
      <div className="page-header-actions">
        {back && (
          <button className="btn btn-secondary" onClick={() => router.push(back.href)}>
            ← {back.label}
          </button>
        )}
        <button className="btn btn-secondary" onClick={() => router.push('/')}>
          🏠 Home
        </button>
      </div>
    </div>
  );
}
