import type { Metadata } from 'next';

export const metadata: Metadata = {
	title: 'DeepClaw Web',
	description: 'DeepClaw Agent Monitor & Control',
};

export default function RootLayout({
	children,
}: Readonly<{
	children: React.ReactNode;
}>) {
	return (
		<html lang="zh-CN">
			<body>{children}</body>
		</html>
	);
}
