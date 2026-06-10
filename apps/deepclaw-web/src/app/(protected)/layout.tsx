import { redirect } from 'next/navigation';
import { validateCurrentAppConfig } from '@deepclaw/gateway';

let valid = false;

export default function ProtectedLayout({ children }: { children: React.ReactNode }) {
    valid = !valid ? validateCurrentAppConfig(false).lacks.length === 0 : valid;
    if (!valid) {
        redirect('/settings');
    }
    return children;
}
