'use client';

type InfoCardProps = {
    title: string;
    icon: React.ReactNode;
    children: React.ReactNode;
  }
  
export function InfoCard({ title, icon, children }: InfoCardProps) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <div className="flex items-center gap-2 mb-4">
          <div className="text-blue-500">{icon}</div>
          <h3 className="font-semibold text-gray-900">{title}</h3>
        </div>
        {children}
      </div>
    );
}
