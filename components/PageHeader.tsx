import { useRouter } from 'next/router';

interface PageHeaderProps {
  title: string;
}

export function PageHeader({ title }: PageHeaderProps) {
  const router = useRouter();
  return (
    <div className="flex items-center justify-between mb-6">
      <h1 className="text-3xl font-semibold mb-0">{title}</h1>
      <button className="btn btn-secondary" onClick={() => router.push('/')}>
        🏠 Home
      </button>
    </div>
  );
}
