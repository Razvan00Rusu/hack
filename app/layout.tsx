import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = { title: 'Greenwave · London traffic lab', description: 'An interactive traffic routing simulation for Marylebone, London.' };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) { return <html lang="en"><body>{children}</body></html>; }
